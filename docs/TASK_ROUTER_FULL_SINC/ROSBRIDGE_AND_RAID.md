# Rosbridge, RAID, and trusting inbound connections

RAID App opens an **outbound** WebSocket to `ws://rosbridgeHost:rosbridgePort` on the robot (often port **9090**). This is **not** symmetric to the robot’s HTTP client to RAID: there is no separate “WS secret” from RAID.

## What you can do on the robot

1. **Network:** firewall, dedicated VLAN, rosbridge port reachable only from RAID server IP.
2. **Proxy in front of rosbridge (e.g. nginx):** validate `X-Teleoperator-Id` / query `teleoperator_id` that RAID adds upstream (unless disabled with RAID `TELEOP_FORWARD_*` vars).
3. **Align with allowlist:** after **sync** from RAID the robot stores `allowedTeleoperatorIds` in JSON (see [rospy_x402 DOC/RAID_INTEGRATION.md](../../rospy_x402/DOC/RAID_INTEGRATION.md)). That file can drive nginx/OpenResty config generation (`map` on `$http_x_teleoperator_id`) or an external filter.

Stock rosbridge does not enforce auth headers — you need another layer.

## Related items

- [ROADMAP.md](ROADMAP.md) — proxy and crypto-grant tasks.
