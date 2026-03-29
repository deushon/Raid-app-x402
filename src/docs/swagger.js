const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const packageJson = require('../../package.json');

const swaggerDefinition = {
  openapi: '3.0.1',
  info: {
    title: 'x402 Raid App API',
    version: packageJson.version || '1.0.0',
    description: 'REST API for managing robots and orchestrating x402-enabled commands.',
  },
  tags: [
    { name: 'Health', description: 'Service diagnostics and readiness checks.' },
    { name: 'Robots', description: 'Robot registration, status, and lifecycle operations.' },
    { name: 'Commands', description: 'High-level actions dispatched to robots.' },
    { name: 'Payments', description: 'x402 payment verification and callbacks.' },
    {
      name: 'Teleoperator',
      description:
        'Registration and login issue a JWT (`accessToken` in JSON and httpOnly cookie `teleop_token`). **Default lifetime is 7 days** (`exp` in the token); set **`TELEOPERATOR_JWT_EXPIRES_IN`** to override (jsonwebtoken duration, e.g. `24h`, `7d`). **This JWT is required** for `GET /api/teleoperator/me`. It is **not** required for `POST /api/teleoperator/register`, `POST /api/teleoperator/login`, or `POST /api/teleoperator/logout` (the latter only clears the cookie).',
    },
    {
      name: 'Teleop',
      description:
        'Robots call `POST /api/robots/{robotId}/teleop/help` with **`X-Robot-Teleop-Secret`** (per-robot secret), not the operator JWT. **Operator JWT** is required for `GET /api/teleoperator/help-requests` and `POST /api/teleoperator/help-requests/{id}/accept`. **Dataset HTTP** from the operator to the robot is proxied at **`/api/teleop/robots/{robotId}/dataset/...`** (same JWT and the same grant rule as accepting help). If the robot has **at least one** active row in **`teleoperator_robot_grants`**, only granted operators see open help requests (HTTP list) and receive **`help_request`** on **`/ws/teleoperator`**; only they may accept or use the dataset proxy. If the robot has **no** active grants, any logged-in operator sees all open requests and gets WS events (backward compatible). WebSockets: same JWT as **`?token=`** on `/ws/teleoperator` and `/ws/teleop/session/{sessionId}`. JWT lifetime: tag **Teleoperator**.',
    },
    { name: 'Admin', description: 'Admin panel API: session cookie from POST /api/admin/login, or HTTP Basic (curl/scripts).' },
    {
      name: 'RobotFleet',
      description:
        '**ROBOT_FLEET_ENROLLMENT_SECRET** as `Authorization: Bearer <secret>` or header **X-Robot-Fleet-Secret**. Used for `POST /api/robots/enroll` and (with admin) mutating `/api/robots` when the secret is configured.',
    },
  ],
  // Relative base so Swagger "Try it out" hits the same host/port as the /docs page.
  // A fixed http://localhost:3000 breaks when /docs is opened via LAN IP (fetch goes to the client PC).
  servers: [
    {
      url: '/',
      description: 'Current origin (recommended for /docs on localhost or LAN)',
    },
  ],
  components: {
    securitySchemes: {
      TeleoperatorCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'teleop_token',
        description:
          'JWT from POST /api/teleoperator/login or register. Default **max age 7 days** (configurable via **TELEOPERATOR_JWT_EXPIRES_IN**). Use on protected routes: GET /api/teleoperator/me, GET /api/teleoperator/help-requests, POST /api/teleoperator/help-requests/{id}/accept; also as **?token=** on /ws/teleoperator and /ws/teleop/session/{sessionId}.',
      },
      TeleoperatorBearer: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Same JWT as **accessToken** or cookie **teleop_token** (default lifetime **7d**, env **TELEOPERATOR_JWT_EXPIRES_IN**). Required for: GET /api/teleoperator/me, GET /api/teleoperator/help-requests, POST /api/teleoperator/help-requests/{id}/accept; WebSocket query **token** on /ws/teleoperator and /ws/teleop/session/{sessionId}.',
      },
      AdminSessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'admin_session',
        description: 'JWT set by POST /api/admin/login (browser UI).',
      },
      AdminBasic: {
        type: 'http',
        scheme: 'basic',
        description: 'ADMIN_USERNAME / ADMIN_PASSWORD (optional; for scripts and curl).',
      },
      RobotFleetBearer: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'fleet-secret',
        description: 'Same value as **ROBOT_FLEET_ENROLLMENT_SECRET** (not a JWT).',
      },
      RobotFleetHeader: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Robot-Fleet-Secret',
        description: 'Same value as **ROBOT_FLEET_ENROLLMENT_SECRET**.',
      },
    },
    schemas: {
      RobotHealthStatus: {
        type: 'object',
        properties: {
          state: { type: 'string', example: 'ready' },
          message: { type: 'string', example: 'Ready for commands' },
          secure: { type: 'boolean', example: false },
          availableMethods: {
            type: 'array',
            items: {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    path: { type: 'string', example: '/commands/dance' },
                    httpMethod: { type: 'string', example: 'POST' },
                    description: { type: 'string', example: 'Run demo dance routine.' },
                    pricing: {
                      type: 'object',
                      nullable: true,
                      properties: {
                        amount: { type: 'number', example: 0.001 },
                        assetSymbol: { type: 'string', example: 'SOL' },
                        receiverAccount: { type: 'string', example: 'So111...' },
                        paymentWindowSec: { type: 'integer', example: 180 },
                      },
                    },
                    parameters: { type: 'object' },
                  },
                },
              ],
            },
          },
        },
      },
      Robot: {
        type: 'object',
        description: 'Full robot record (includes teleopSecret). Admin **GET /api/admin/robots** and enroll/POST responses.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Robo-1' },
          host: { type: 'string', example: '192.168.1.10' },
          port: { type: 'integer', example: 8080 },
          requiresX402: { type: 'boolean', example: false },
          rosbridgeHost: { type: 'string', description: 'ROSBridge WebSocket host (defaults to host)' },
          rosbridgePort: { type: 'integer', example: 9090, description: 'ROSBridge port' },
          teleopSecret: {
            type: 'string',
            nullable: true,
            description: 'Per-robot secret for POST /api/robots/{id}/teleop/help. Omitted from public GET /api/robots.',
          },
          enrollmentKey: {
            type: 'string',
            nullable: true,
            description: 'Stable id for fleet self-enrollment upsert (POST /api/robots/enroll).',
          },
          operatorRegistryUrl: {
            type: 'string',
            nullable: true,
            description: 'Optional full URL on the robot for allowlist sync (see docs/ROBOT_OPERATOR_SYNC.md).',
          },
          datasetHttpHost: {
            type: 'string',
            nullable: true,
            description:
              'Optional LAN host for dataset HTTP (default: same as host). Used by GET/POST /api/teleop/robots/{id}/dataset/... proxy.',
          },
          datasetHttpPort: {
            type: 'integer',
            nullable: true,
            description: 'Optional dataset HTTP port (default 9191).',
          },
          status: { $ref: '#/components/schemas/RobotHealthStatus' },
          lastHealthCheckAt: { type: 'string', format: 'date-time', nullable: true },
          location: {
            type: 'object',
            nullable: true,
            description: 'Last known geo position from robot health payload (top-level on the robot object).',
            properties: {
              lat: { type: 'number', example: 55.7522 },
              lng: { type: 'number', example: 37.6156 },
            },
          },
        },
      },
      RobotPublic: {
        type: 'object',
        description: 'Robot as returned by **GET /api/robots** (no teleopSecret).',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          host: { type: 'string' },
          port: { type: 'integer' },
          requiresX402: { type: 'boolean' },
          rosbridgeHost: { type: 'string' },
          rosbridgePort: { type: 'integer' },
          enrollmentKey: { type: 'string', nullable: true },
          operatorRegistryUrl: { type: 'string', nullable: true },
          datasetHttpHost: { type: 'string', nullable: true },
          datasetHttpPort: { type: 'integer', nullable: true },
          status: { $ref: '#/components/schemas/RobotHealthStatus' },
          lastHealthCheckAt: { type: 'string', format: 'date-time', nullable: true },
          location: { type: 'object', nullable: true },
        },
      },
      RobotEnrollRequest: {
        type: 'object',
        required: ['enrollmentKey', 'host', 'port'],
        properties: {
          enrollmentKey: {
            type: 'string',
            description: 'Stable hardware/device id; same key updates the same robot row.',
          },
          name: { type: 'string' },
          host: { type: 'string' },
          port: { type: 'integer' },
          requiresX402: { type: 'boolean' },
          rosbridgeHost: { type: 'string' },
          rosbridgePort: { type: 'integer' },
          teleopSecret: {
            type: 'string',
            description: 'Optional; if omitted, server generates and returns one.',
          },
          operatorRegistryUrl: {
            type: 'string',
            description: 'Optional allowlist endpoint URL on the robot.',
          },
          datasetHttpHost: {
            type: 'string',
            description: 'Optional; overrides host for operator dataset HTTP proxy.',
          },
          datasetHttpPort: {
            type: 'integer',
            description: 'Optional; default 9191 for dataset proxy upstream.',
          },
        },
      },
      RegisterRobotRequest: {
        type: 'object',
        required: ['host', 'port'],
        properties: {
          name: { type: 'string' },
          host: { type: 'string', example: '192.168.1.10' },
          port: { type: 'integer', example: 8080 },
          requiresX402: { type: 'boolean', example: false },
          rosbridgeHost: { type: 'string', description: 'Optional; defaults to host' },
          rosbridgePort: { type: 'integer', example: 9090 },
          teleopSecret: {
            type: 'string',
            description: 'Shared secret for POST /api/robots/{id}/teleop/help.',
          },
          enrollmentKey: { type: 'string', description: 'Optional stable key (prefer POST /api/robots/enroll for upsert).' },
          datasetHttpHost: { type: 'string', description: 'Optional dataset HTTP host for teleop proxy.' },
          datasetHttpPort: { type: 'integer', description: 'Optional dataset HTTP port (default 9191).' },
          operatorRegistryUrl: { type: 'string', description: 'Optional; see docs/ROBOT_OPERATOR_SYNC.md' },
        },
      },
      DanceCommandRequest: {
        type: 'object',
        required: ['quantity'],
        properties: {
          quantity: {
            oneOf: [
              { type: 'string', enum: ['all'] },
              { type: 'integer', enum: [1, 2] },
            ],
            example: 'all',
          },
        },
      },
      BuyColaCommandRequest: {
        type: 'object',
        required: ['location', 'quantity'],
        properties: {
          location: {
            type: 'object',
            required: ['lat', 'lng'],
            properties: {
              lat: { type: 'number', example: 55.7522 },
              lng: { type: 'number', example: 37.6156 },
            },
          },
          quantity: { type: 'integer', example: 3 },
        },
      },
      TeleoperatorRegisterRequest: {
        type: 'object',
        required: ['login', 'password', 'walletPublicKey'],
        properties: {
          login: { type: 'string', example: 'operator1' },
          password: { type: 'string', format: 'password', minLength: 8 },
          walletPublicKey: { type: 'string', description: 'Solana address (base58)' },
        },
      },
      TeleoperatorLoginRequest: {
        type: 'object',
        required: ['login', 'password'],
        properties: {
          login: { type: 'string' },
          password: { type: 'string', format: 'password' },
        },
      },
      TeleoperatorPublicProfile: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          login: { type: 'string' },
          walletPublicKey: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      TeleoperatorAuthResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          user: { $ref: '#/components/schemas/TeleoperatorPublicProfile' },
          accessToken: {
            type: 'string',
            description:
              'JWT (`sub` = user id, `login`, standard `iat`/`exp`). Default **7d** until **exp**; override server-side with **TELEOPERATOR_JWT_EXPIRES_IN**. Use as **Authorization: Bearer** (or cookie in browser) on protected teleoperator/teleop routes and as **?token=** for teleop WebSockets.',
          },
        },
      },
      AdminLoginRequest: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', example: 'admin' },
          password: { type: 'string', format: 'password' },
        },
      },
    },
  },
};

const swaggerSpec = swaggerJsdoc({
  swaggerDefinition,
  apis: [
    path.join(__dirname, '../index.js'),
    path.join(__dirname, '../routes/*.js'),
  ],
});

module.exports = {
  swaggerSpec,
  swaggerUi,
};

