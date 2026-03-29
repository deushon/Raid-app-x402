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
        'Robots call `POST /api/robots/{robotId}/teleop/help` with **`X-Robot-Teleop-Secret`** (shared secret), not the operator JWT. **Operator JWT** (same as teleoperator session) is required for `GET /api/teleoperator/help-requests` and `POST /api/teleoperator/help-requests/{id}/accept`. Pass the same token as **`?token=`** on WebSockets `/ws/teleoperator` (help events) and `/ws/teleop/session/{sessionId}` (duplex ROSBridge proxy). JWT lifetime: see tag **Teleoperator**.',
    },
    { name: 'Admin', description: 'Admin panel API: session cookie from POST /api/admin/login, or HTTP Basic (curl/scripts).' },
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
            description:
              'Shared secret for POST /api/robots/{id}/teleop/help. Currently included in GET /api/robots and other robot JSON responses; treat as sensitive.',
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
            description:
              'Shared secret for POST /api/robots/{id}/teleop/help; echoed in GET /api/robots and robot responses until restricted.',
          },
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

