# AI agent instructions (x402 Raid App)

This file complements [README.md](README.md) for humans. It records **mandatory** rules for any changes in this repository (including from automated assistants).

## Language policy (Cursor / AI assistants)

This repository is published internationally; **all** automated assistants (Cursor, CI, other agents) must follow this split:

### Chat with humans (mandatory)

- **Reply in Russian** when the maintainer writes in Russian (default for this team). If they switch language, match their language.
- This applies to **conversation only** — explanations, questions, and summaries directed at the person in the chat UI.

### Repository and runtime product text (mandatory)

- **Do not use Russian (or any non-English user-facing copy) anywhere in the codebase or committed files:** source, comments, commit messages, logs intended for operators, CLI help, **`config/env.example`**, deployment samples, **README.md**, **`docs/`**, OpenAPI/JSDoc, **HTML/JS/CSS UI strings**, test names and assertion messages that ship in-repo, and sample `.env` comments (use **`config/env.example`** as the canonical English template).
- Local **`.env`** is gitignored but should still use **English** comments so copies and screenshots stay safe for an international audience.
- **`npm test`** includes **`test/no-cyrillic-in-repo.test.js`** — CI must stay green; fix Cyrillic at the source instead of excluding paths without maintainer approval.

### Commit messages

- Use **English**, clear, and imperative where conventional (public repo).

## Project scope

Stack: **Node.js + Express** in `src/`, static UI in `public/`, sample configuration in `config/`, x402 protocol notes in `docs/X402_PROTOCOL.md`.

## Required practices for any change

### 1. README stays accurate for operators

- For **every** functional change (new routes, environment variables, behavior, UI entry points, defaults), **update [README.md](README.md)** in the same change set.
- Tables (URLs, API overview, configuration) must match the code so a human can run and operate the service without reading the diff.
- If you add or rename environment variables, keep **README.md** and **config/env.example** in sync.

### 2. Swagger / OpenAPI is part of the API contract

- The spec is built with **swagger-jsdoc**: [src/docs/swagger.js](src/docs/swagger.js) + JSDoc blocks `**@openapi`** in [src/index.js](src/index.js) and [src/routes/](src/routes/).
- When **adding, removing, or changing** a public HTTP endpoint (path, method, body, responses, auth):
  - update or add the matching `**@openapi`** block on the router (or in `index.js` for root routes);
  - extend `**components.schemas**` in [src/docs/swagger.js](src/docs/swagger.js) if needed;
  - ensure new route files are covered by `apis` in `swagger.js` (currently `../routes/*.js`).
- After edits, check that **Swagger UI** `/docs` and **JSON** `/docs-json` match real behavior.

### 3. Tests for every touched area

- **Do not change behavior without tests** that cover the affected logic (unit or integration as appropriate).
- Test layout must match the runner in [package.json](package.json); if `test` was a stub, **add a runner and a working `npm test`** when real tests appear.
- Cover: new route handlers, branches in services (`commandRouter`, `x402Service`, `clientPaymentService`, `aiAgentService`, `settingsStore`, etc.), and `config.js` when behavior changes.

### 4. Commits

- Use **clear commit messages** (imperative mood; first line = summary).
- Prefer one logical change per commit; the branch must not leave README, Swagger, or tests out of date.

## Architecture map

| Component | Role |
| --------- | ---- |
| [src/index.js](src/index.js) | App assembly, middleware, routers, `/health`, x402 callback example, `/docs` |
| [src/config.js](src/config.js) | Env/CLI, `buildSolanaRpcUrl` |
| [src/routes/robots.js](src/routes/robots.js) | Robot registry API |
| [src/routes/commands.js](src/routes/commands.js) | `dance`, `buy-cola` |
| [src/routes/client.js](src/routes/client.js) | Public client API: settings, estimate, invoice, execute |
| [src/routes/admin.js](src/routes/admin.js) | Admin API: login/session, AI config, client RPC (cookie or Basic) |
| [src/routes/teleoperator.js](src/routes/teleoperator.js) | Teleoperator API: register, login, JWT session (cookie) |
| [src/routes/teleopHelp.js](src/routes/teleopHelp.js) | Robot help requests, accept, broadcast to WS hub |
| [src/routes/teleopDataset.js](src/routes/teleopDataset.js) | OpenAPI for dataset proxy **`/api/teleop/robots/:id/dataset/*`** (logic in `teleopDatasetProxy`) |
| [src/services/teleopDatasetProxy.js](src/services/teleopDatasetProxy.js) | HTTP reverse proxy: operator JWT → dataset on robot (stream, grants) |
| [src/ws/teleopServer.js](src/ws/teleopServer.js) | Upgrade: `/ws/teleoperator`, `/ws/teleop/session/:id` → duplex to rosbridge |
| [src/services/teleopHelpRepository.js](src/services/teleopHelpRepository.js) | PostgreSQL: `help_requests`, `teleop_sessions` |
| [src/services/teleopOperatorHub.js](src/services/teleopOperatorHub.js) | Broadcast JSON events to connected teleoperators |
| [src/db/ensureTeleopHelpSchema.js](src/db/ensureTeleopHelpSchema.js) | DDL for teleop tables |
| [src/db/ensureRobotSchema.js](src/db/ensureRobotSchema.js) | DDL for **`robots`** (persistent registry when `DATABASE_URL` is set) |
| [src/services/robotRepository.js](src/services/robotRepository.js) | Read/write robots in PostgreSQL |
| [src/middleware/adminAuth.js](src/middleware/adminAuth.js) | Admin session (cookie JWT); Basic optional for `/api/admin` |
| [src/middleware/teleopSession.js](src/middleware/teleopSession.js) | Teleoperator JWT/cookie session |
| [src/db/ensureTeleoperatorSchema.js](src/db/ensureTeleoperatorSchema.js) | DDL for `teleoperators` (PostgreSQL) |
| [src/services/teleoperatorRepository.js](src/services/teleoperatorRepository.js) | Teleoperator users in DB (bcrypt, Solana pubkey) |
| [src/services/peaqClaimService.js](src/services/peaqClaimService.js) | Peaq SDK **`did.read`**, **`buildFailureClaim`** on read errors (DB fallback, no endless **404**) |
| [scripts/peaqOnboardMachine.js](scripts/peaqOnboardMachine.js) | One-off **`did.create`** + **`sendEvmTx`** on Agung; exports **`onboardPeaqMachine`** for future robot enroll |
| [scripts/peaqFaucetRequest.js](scripts/peaqFaucetRequest.js) | **POST** to official AGNG faucet API from Node (bypasses browser CORS/524 pages); **`npm run peaq:faucet`** |
| [src/docs/swagger.js](src/docs/swagger.js) | OpenAPI base and shared JSDoc schemas |
| [src/services/](src/services/) | Registry, health, commands, x402, payments, executor selection, settings |

## Do not

- Commit **`.env`**, real keys in JSON configs, **repository snapshot archives** (`*.zip`, etc.), or contents of **`private/`** (local drafts; public static assets live in `public/`).
- Leave [README.md](README.md) or OpenAPI **out of sync** with the code.
- Add endpoints **only** in prose without `@openapi` and, when needed, without schemas in `swagger.js`.
- Merge logic changes **without** tests and a meaningful commit message.

### PostgreSQL data (teleoperators, robots, help requests, grants)

- **Never** run or suggest to the user without their explicit written request: **`DROP DATABASE`**, **`DROP TABLE`** (production tables), **`TRUNCATE`** on `teleoperators`, `robots`, `help_requests`, `teleop_sessions`, `teleoperator_robot_grants`, or removing the Docker volume (**`docker compose down -v`**, manual removal of **`x402_raid_pgdata`**).
- **Do not** point integration tests that `TRUNCATE`/`DROP` at the user’s production **`DATABASE_URL`**; use a **separate** test DB (e.g. **`TEST_DATABASE_URL`** in this repo), never compose/production Postgres.
- When debugging on the user’s machine: do not wipe the database “for a clean experiment”; use a copy, a separate container, or wait for explicit user approval.
