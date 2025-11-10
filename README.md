# x402 Raid Control Service

Node.js service orchestrating x402-enabled payments and robot control flows. It exposes REST endpoints to register and monitor robots, trigger collaborative commands (for example, `dance` and `buy-cola`), and serves a lightweight web console for day-to-day operations.

## Features

- x402-ready request signing for outgoing robot commands and verification middleware for incoming payment callbacks.
- Health monitoring pipeline that polls robot `/health` (and `/helth` for legacy setups) endpoints with optional x402 fallback.
- In-memory robot registry with status, available method discovery, and location tracking.
- Command router that distributes work across available robots, including proximity-based selection for logistics scenarios.
- Static web UI (`/ui`) for robot registration, status review, and quick command dispatch.

## Getting Started

### Prerequisites

- Node.js 18 or later.
- npm 9 or later.
- A valid x402 private key (if you plan to access secured robot endpoints or verify payments).

### Installation

```bash
npm install
```

### Configuration

Environment variables can be provided via a `.env` file (copy `config/env.example`) or directly in the shell. Command-line flags override environment variables when present.

| Environment variable | CLI flag | Description | Default |
| --- | --- | --- | --- |
| `HOST` | `--host` | Network interface for the HTTP server | `0.0.0.0` |
| `PORT` | `--port` | HTTP port for the control service | `3000` |
| `X402_PRIVATE_KEY` | `--x402-private-key` | Private key used to sign x402 requests | _required for secure robots_ |
| `X402_WALLET_ID` | `--x402-wallet-id` | Optional wallet identifier header for x402 integrations | _none_ |
| `X402_GATEWAY_URL` | `--x402-gateway-url` | Base URL for upstream x402 gateways | `https://api.corbits.dev` |
| `ROBOT_HEALTH_TIMEOUT_MS` | `--robot-health-timeout` | Health-check timeout per robot (ms) | `5000` |
| `ROBOT_COMMAND_TIMEOUT_MS` | `--robot-command-timeout` | Command dispatch timeout (ms) | `8000` |
| `ROBOT_HEALTH_ENDPOINT` | `--robot-health-endpoint` | Public health endpoint path | `/health` |
| `ROBOT_SECURE_HEALTH_ENDPOINT` | `--robot-secure-health-endpoint` | Secured health endpoint path (x402) | `/helth` |

### Scripts

```bash
npm run start      # run the production server
npm run dev        # run in watch mode with nodemon
```

### API Overview

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Service heartbeat and high-level state. |
| `GET` | `/api/robots` | List registered robots and their status. |
| `POST` | `/api/robots` | Register a new robot `{ host, port, name?, requiresX402? }`. |
| `PUT` | `/api/robots/{id}` | Update robot metadata. |
| `POST` | `/api/robots/{id}/refresh` | Trigger an immediate health check. |
| `DELETE` | `/api/robots/{id}` | Remove a robot from the registry. |
| `POST` | `/api/commands/dance` | Dispatch the dance command `{ mode: 1 | 2 | "all" }`. |
| `POST` | `/api/commands/buy-cola` | Dispatch a logistics task `{ location, quantity }`. |
| `POST` | `/api/payments/x402` | Example endpoint protected by x402 middleware. Post payment callbacks here. |

### Web Console

Open `http://localhost:3000/` (adjust host/port as needed). The console supports:

- Registering robots and marking them as x402-secured.
- Viewing status, rich method cards (with pricing and parameters), and location per robot.
- Triggering `dance` and `buy-cola` commands.
- Map view with markers for every robot reporting coordinates.
- Manual refresh (per robot or bulk) and removal controls.

### API Reference

- OpenAPI/Swagger UI is available at `http://localhost:3000/docs`.
- `swagger.json` can be retrieved from `http://localhost:3000/docs-json` for automation or SDK generation.

### Robot Expectations

Robots should expose at least:

- `GET /health` (or `/helth`) → `{ status, message?, availableMethods?, location? }`.
- `POST /commands/dance` → payload `{ mode }`.
- `POST /commands/buy-cola` → payload `{ location, quantity }`.

`availableMethods` can be an array of plain strings or objects with structure:

```json
{
  "path": "/commands/dance",
  "httpMethod": "POST",
  "description": "Trigger a sample motion.",
  "parameters": {
    "kwargs": { "demo_name": "wave" }
  },
  "pricing": {
    "amount": 0.001,
    "assetSymbol": "SOL",
    "receiverAccount": "So11111111111111111111111111111111111111112",
    "paymentWindowSec": 180
  }
}
```

If a robot is configured as `requiresX402`, all outgoing requests will include `x-402-signature` (and `x-402-wallet` when provided). Customise `src/services/x402Service.js` to align with your deployment’s x402 quickstart guidelines.

### Extending the Service

- **Persistence:** swap the in-memory registry with a database-backed implementation.
- **Automation:** schedule periodic health checks with a job runner (BullMQ, Agenda, etc.).
- **Commands:** add new command handlers via `src/services/commandRouter.js` and expose routes inside `src/routes/commands.js`.
- **Security:** protect the REST API with authentication middleware or API keys before production use.

### Development Notes

- All logs emit JSON-friendly structured strings.
- Errors bubble through the Express error handler for consistent responses.
- Comments and logging are in English for broader team collaboration, per requirements.

