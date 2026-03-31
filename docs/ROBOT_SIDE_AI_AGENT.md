# Guide for agents/developers: robot-side code and RAID App integration

For an AI agent or human **extending robot software** (ROS node, `teleop_fetch`, systemd, nginx in front of rosbridge, etc.). Describes **how RAID App works today** and **contracts the robot must follow**. RAID sources: `x402_raid_app` repository (branch/deploy with your team).

---

## 1. Roles and boundaries

| Component | Where it runs | Responsibility |
|-----------|---------------|----------------|
| **RAID App** | Server (Node.js) | Robot registry, fleet secret, enroll, teleop help intake, teleoperator JWT, WS proxy operator ↔ rosbridge, operator↔robot grants table, optional HTTP allowlist push to robot. |
| **Robot** | Your code | HTTP client to RAID (enroll, help), **local storage** of `robotId`, `teleopSecret`, fleet secret; optionally **HTTP allowlist server** and/or **filtering inbound** connections to rosbridge (9090). |

**Important:** “mutual auth” is **not symmetric on the wire**. The robot proves itself to RAID with **HTTP secrets** (fleet + per-robot `teleopSecret`). RAID **does not** sign the outbound WebSocket to rosbridge separately: the robot sees a normal WS with operator UUID in headers/query. **Trust that this is “legitimate RAID”** is **your** problem (network, firewall, optional dedicated port for RAID IP, header checks + allowlist).

---

## 2. Minimum robot configuration

Agree with the fleet operator on values from RAID `.env` (robots do not invent these; the RAID team provides them):

| On robot | Matches on RAID | Purpose |
|----------|-----------------|---------|
| Base RAID URL | `http(s)://<host>:<port>` | All API calls. |
| **`ROBOT_FLEET_ENROLLMENT_SECRET`** (same string) | `ROBOT_FLEET_ENROLLMENT_SECRET` in RAID `.env` | **`POST /api/robots/enroll`** and other mutating `/api/robots` with fleet auth. |
| **`enrollmentKey`** | Not a “secret” on RAID; stable device id | Idempotent registration: one key → one `robotId`. |
| **`robotId`** (UUID) | `id` field in enroll response | Persist to disk after first successful enroll; use in help URL. |
| **`teleopSecret`** | `teleopSecret` in enroll / admin response | **`POST /api/robots/{robotId}/teleop/help`**. Public **`GET /api/robots`** does **not** expose it. |
| (optional) Allowlist URL | Value for **`operatorRegistryUrl`** on enroll | Full URL of your robot `POST` handler; RAID calls it on sync (see §7). |
| (optional) **`RAID_TO_ROBOT_SECRET`** (same string) | `RAID_TO_ROBOT_SECRET` in RAID `.env` | Validate **`X-Raid-To-Robot-Secret`** on your allowlist handler. |

**Discovering RAID host:** with **`MDNS_ENABLED`** and **`MDNS_HOSTNAME`** (e.g. `raid-app`) on the server, LAN may use **`http://raid-app.local:<PORT>`** instead of IP. Docker + bridge often breaks mDNS — confirm with deploy team.

---

## 3. Talking to RAID: integration order

### Step A — Enroll (self-registration)

1. **`POST {RAID_BASE}/api/robots/enroll`**
2. Header: **`X-Robot-Fleet-Secret: <ROBOT_FLEET_ENROLLMENT_SECRET>`**  
   **or** **`Authorization: Bearer <ROBOT_FLEET_ENROLLMENT_SECRET>`**
3. JSON body (required):
   - **`enrollmentKey`** — stable string (serial, MAC, firmware UUID).
   - **`host`**, **`port`** — how **other LAN nodes reach the robot HTTP/health** (not localhost if RAID is elsewhere).
   - Optional: **`rosbridgeHost`**, **`rosbridgePort`** (default port **9090**), **`name`**, **`teleopSecret`** (RAID generates if omitted), **`operatorRegistryUrl`** (full allowlist API URL).
4. Success: **200**, body is robot object with **`id`**, **`teleopSecret`**, etc. Save **`id`** as `robotId` and **`teleopSecret`** durably.
5. Repeat enroll with same **`enrollmentKey`** **updates** the same row (**same `id`**). Call when IP/port changes or after repair.

If RAID has no `ROBOT_FLEET_ENROLLMENT_SECRET`, enroll returns **503** — server config, not a robot bug.

Details: [TELEOP_FETCH.md](./TELEOP_FETCH.md) (enroll section).

### Step B — Teleop help request

1. **`POST {RAID_BASE}/api/robots/{robotId}/teleop/help`**
2. Header: **`X-Robot-Teleop-Secret: <teleopSecret>`** or **`Authorization: Bearer <teleopSecret>`**
3. JSON: required string **`message`**. Recommended **`metadata`**: **`task_id`**, **`error_context`** (string, may be `""`), optional **`situation_report`** (long UTF-8 for operator/VR). Without **`metadata`**, RAID still accepts and fills standard fields with empty strings.
4. **201** — new request; **200** + **`duplicate: true`** — already open (avoid spam). **400** — no string **`message`**.

Operators and VR **do not** hit the robot for this step; they use RAID (JWT, WebSocket on RAID).

### Step C — What happens on rosbridge (after operator accept)

When an operator accepts and connects to the proxy, **RAID** opens an **outbound** WebSocket to **`ws://rosbridgeHost:rosbridgePort`** (from robot card).

By default RAID adds:

- Headers (unless disabled): **`X-Teleoperator-Id`**, **`X-Teleoperator-Login`**
- Query: **`teleoperator_id`**, **`teleoperator_login`**

**Operator JWT is not sent to the robot.** Operator identity for robot policy is the **PostgreSQL UUID** on RAID (matches JWT `sub` on RAID).

Disable on RAID: **`TELEOP_FORWARD_OPERATOR_HEADERS`**, **`TELEOP_FORWARD_OPERATOR_QUERY`** (see RAID README).

**Your job on the robot:** if you need “operator auth on robot”, implement checks **after** traffic reaches rosbridge (proxy, plugin, wrapper). Stock rosbridge often **ignores** these headers — typical pattern is **nginx** or a dedicated port only for a “trusted” source.

---

## 4. RAID → robot: operator allowlist push (optional)

If enroll included **`operatorRegistryUrl`**, a RAID admin can trigger sync. Contract: [ROBOT_OPERATOR_SYNC.md](./ROBOT_OPERATOR_SYNC.md):

- **POST** to the **exact** URL (RAID does not append paths).
- Header **`X-Raid-To-Robot-Secret`** = **`RAID_TO_ROBOT_SECRET`** from RAID `.env` (must match what you verify on the robot).
- Body: `{ "allowedTeleoperatorIds": ["uuid", …] }` — only operators with **active grant** for that robot on RAID.

If secret or URL is missing, RAID **does not** call the robot (sync response: `skipped`).

---

## 5. ACL “who may accept a request” (RAID logic)

RAID maintains **`teleoperator_robot_grants`**:

- If the robot has **no** active grant rows — **any** logged-in teleoperator may accept help (**legacy behavior**).
- If there is **at least one** grant — only **granted** operators may accept.

Admin UI: **`/ui/teleop-access.html`** on RAID (admin session).

The robot does **not** configure this; it only posts help. Consistency with robot allowlist: admin **creates grant on RAID** and **runs sync** (or you sync lists another way).

---

## 6. Useful endpoints and checks

| Request | Purpose |
|---------|---------|
| **`GET {RAID_BASE}/health`** | `teleoperatorEnabled`, `teleopWs` — is teleop up on RAID. |
| **`GET {RAID_BASE}/api/robots`** | Public list **without** `teleopSecret` (debug “is our robot registered” via admin `enrollmentKey`, not this GET). |

OpenAPI: **`/docs`**, **`/docs-json`**.

---

## 7. Agent behavior while developing (recommendations)

1. **Do not hardcode secrets** — read from env / permissions file on the robot.
2. **Persistence:** after enroll save `robotId` and `teleopSecret`; on service start read from disk or re-enroll with same `enrollmentKey` (same data if row unchanged).
3. **Network:** RAID must reach `host:port` (health) and `rosbridgeHost:rosbridgePort`; robot must reach RAID over HTTP(S).
4. **Timeouts and retries:** enroll and help with backoff; on **401** for help do not retry forever (wrong secret or `robotId`).
5. **Logs:** do not print full secrets or Bearer tokens.
6. **Test without hardware:** run RAID locally (docker compose), set secrets, enroll with `host` = robot LAN IP or test bench.

---

## 8. RAID source map (read the contract)

| Topic | Files |
|-------|-------|
| Enroll and `/api/robots` protection | `src/routes/robots.js`, `src/middleware/robotFleetAuth.js` |
| Help | `src/routes/teleopHelp.js` |
| WS proxy → rosbridge | `src/ws/teleopServer.js` (`buildRosbridgeWebSocketTarget`) |
| Registry, enroll upsert | `src/services/robotRegistry.js`, `src/services/robotRepository.js` |
| Grants, accept | `src/routes/teleopHelp.js`, `src/services/teleoperatorRobotGrantRepository.js` |
| Allowlist push | `src/services/robotOperatorSync.js` |
| mDNS | `src/services/mdnsAdvertisement.js`, `src/config.js` (`mdns`) |

---

## 9. Related docs in this repository

- [TELEOP_FETCH.md](./TELEOP_FETCH.md) — HTTP help and enroll from the robot’s perspective.
- [ROBOT_OPERATOR_SYNC.md](./ROBOT_OPERATOR_SYNC.md) — POST allowlist contract to the robot.
- [README.md](../README.md) — environment variables, API tables, Docker.

If RAID behavior diverges from this doc, **source of truth is code and OpenAPI**; update this file or README after team agreement.
