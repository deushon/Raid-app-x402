const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const { loadConfig } = require('./config');
const logger = require('./utils/logger');
const X402Service = require('./services/x402Service');
const createHealthMonitor = require('./services/healthMonitor');
const RobotRegistry = require('./services/robotRegistry');
const createCommandRouter = require('./services/commandRouter');
const createRobotsRouter = require('./routes/robots');
const createCommandsRouter = require('./routes/commands');
const createClientRouter = require('./routes/client');
const createAdminRouter = require('./routes/admin');
const createTeleoperatorRouter = require('./routes/teleoperator');
const createX402PaymentMiddleware = require('./middleware/x402Payment');
const {
  createAdminUiGuardMiddleware,
  warnDefaultAdminPassword,
} = require('./middleware/adminAuth');
const {
  createAttachTeleopUser,
  createRequireTeleopSession,
} = require('./middleware/teleopSession');
const { ensureTeleoperatorSchema } = require('./db/ensureTeleoperatorSchema');
const { ensureTeleopHelpSchema } = require('./db/ensureTeleopHelpSchema');
const createTeleopHelpRouter = require('./routes/teleopHelp');
const { createTeleopOperatorHub } = require('./services/teleopOperatorHub');
const { attachTeleopWebSockets } = require('./ws/teleopServer');
const { swaggerSpec, swaggerUi } = require('./docs/swagger');
const settingsStore = require('./services/settingsStore');

const bootstrap = async () => {
  const config = loadConfig(process.argv.slice(2));
  const { server } = config;

  if (process.env.NODE_ENV === 'production' && !config.admin.sessionSecret) {
    logger.error(
      'ADMIN_SESSION_SECRET or TELEOPERATOR_JWT_SECRET is required in production for admin session signing',
    );
    process.exit(1);
  }
  warnDefaultAdminPassword(config.admin);
  logger.info('Admin panel /ui login: use ADMIN_USERNAME / ADMIN_PASSWORD (not teleoperator DB login)', {
    adminUsername: config.admin.username,
  });

  if (server.host === '127.0.0.1' || server.host === '::1') {
    logger.warn(
      'Server is bound to loopback only; other machines cannot open API/UI. '
      + 'Use HOST=0.0.0.0 (default) to listen on all interfaces.',
    );
  }

  if (config.database.url && !config.teleoperator.jwtSecret) {
    logger.error('TELEOPERATOR_JWT_SECRET is required when DATABASE_URL is set');
    process.exit(1);
  }

  let pool = null;
  if (config.database.url) {
    pool = new Pool({ connectionString: config.database.url });
    try {
      await ensureTeleoperatorSchema(pool);
      await ensureTeleopHelpSchema(pool);
    } catch (error) {
      logger.error('Failed to ensure teleoperator schema', { error: error.message });
      await pool.end().catch(() => {});
      process.exit(1);
    }
  } else {
    logger.warn('DATABASE_URL is not set; teleoperator API and /teleoperator UI are disabled.');
  }

  settingsStore.init(config);

  const x402Service = new X402Service(config.x402);
  const healthMonitor = createHealthMonitor({ config, x402Service });
  const registry = new RobotRegistry({ healthMonitor });
  const commandRouter = createCommandRouter({ config, registry, x402Service });
  const teleopHub = pool ? createTeleopOperatorHub() : null;

  const app = express();
  if (config.server.trustProxy) {
    app.set('trust proxy', config.server.trustProxy);
  }
  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-Robot-Teleop-Secret',
      ],
    }),
  );
  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Admin panel: cookie session (login page) + optional Basic on /api/admin only
  // Do not register app.get('/ui') → redirect to '/ui/': in Express 5 that route also matches
  // GET /ui/ and causes an infinite 302 loop. Trailing slash is handled by express.static (301 /ui → /ui/).
  app.use(
    '/ui',
    createAdminUiGuardMiddleware(config.admin),
    express.static(path.join(__dirname, '..', 'public')),
  );

  // Public client UI
  app.use('/client', express.static(path.join(__dirname, '..', 'public', 'client')));
  app.get('/client', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'client', 'index.html'));
  });

  if (pool) {
    const attachTeleopUser = createAttachTeleopUser(config.teleoperator);
    const teleoperatorPublicRoot = path.join(__dirname, '..', 'public', 'teleoperator');
    const teleoperatorCabinetFile = path.join(__dirname, '..', 'private', 'teleoperator', 'cabinet.html');

    app.get(
      '/teleoperator/cabinet',
      attachTeleopUser,
      (req, res, next) => {
        if (req.teleopUser?.id) {
          return next();
        }
        const nextParam = encodeURIComponent(req.originalUrl || '/teleoperator/cabinet');
        return res.redirect(302, `/teleoperator/login.html?next=${nextParam}`);
      },
      (req, res) => {
        res.sendFile(teleoperatorCabinetFile);
      },
    );

    app.get('/teleoperator', (req, res) => {
      res.sendFile(path.join(teleoperatorPublicRoot, 'index.html'));
    });
    app.get('/teleoperator/', (req, res) => {
      res.redirect(302, '/teleoperator');
    });
    app.use('/teleoperator', express.static(teleoperatorPublicRoot));
    app.use('/api/teleoperator', createTeleoperatorRouter({ pool, config }));

    app.use(
      '/api',
      createTeleopHelpRouter({
        pool,
        registry,
        teleopHub,
        attachTeleopUser,
        requireTeleopSession: createRequireTeleopSession({ mode: 'json' }),
      }),
    );
  }

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
  app.get('/docs-json', (req, res) => {
    res.json(swaggerSpec);
  });

  /**
   * @openapi
   * /health:
   *   get:
   *     tags:
   *       - Health
   *     summary: Service readiness snapshot
   *     description: Returns uptime information and high-level robot counts.
   *     responses:
   *       200:
   *         description: Service is online.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                   example: ok
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *                 robots:
   *                   type: integer
   *                   example: 3
   *                 x402Configured:
   *                   type: boolean
   *                   example: true
   *                 teleopWs:
   *                   type: boolean
   *                   description: WebSocket teleop upgrade handler enabled (DATABASE_URL + TELEOP_WS_ENABLED)
   *                   example: true
   */
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      robots: registry.list().length,
      x402Configured: x402Service.isConfigured(),
      teleopWs: Boolean(pool && teleopHub && config.teleop?.enabled),
    });
  });

  app.use('/api/robots', createRobotsRouter({ registry }));
  app.use('/api/commands', createCommandsRouter({ commandRouter }));
  app.use('/api/client', createClientRouter({
    registry,
    commandRouter,
    x402Service,
    config,
    getSolanaRpcUrl: settingsStore.getSolanaRpcUrl,
    getSettings: settingsStore.getSettings,
    saveSettings: settingsStore.saveSettings,
  }));
  app.use('/api/admin', createAdminRouter({ settingsStore, adminConfig: config.admin }));

  /**
   * @openapi
   * /api/payments/x402:
   *   post:
   *     tags:
   *       - Payments
   *     summary: Validate incoming x402 payment callback
   *     description: Verifies payload signature using the configured private key and echoes the payload.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             additionalProperties: true
   *     responses:
   *       200:
   *         description: Signature is valid.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                 payload:
   *                   type: object
   *                   additionalProperties: true
   *       401:
   *         description: Missing or invalid signature.
   *       503:
   *         description: x402 verification is not configured.
   */
  app.post(
    '/api/payments/x402',
    createX402PaymentMiddleware(x402Service),
    (req, res) => {
      res.json({
        status: 'payment_verified',
        payload: req.body,
      });
    },
  );

  // Redirect root to client UI
  app.get('/', (req, res) => {
    res.redirect('/client');
  });

  app.use((err, req, res, next) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  const httpServer = http.createServer(app);

  if (pool && teleopHub && config.teleop?.enabled) {
    attachTeleopWebSockets(httpServer, {
      config,
      pool,
      registry,
      teleopHub,
    });
  }

  const serverInstance = httpServer.listen(server.port, server.host, () => {
    logger.info('x402 Raid App server started', {
      host: server.host,
      port: server.port,
      x402Configured: x402Service.isConfigured(),
      teleoperatorEnabled: Boolean(pool),
      teleopWs: Boolean(pool && teleopHub && config.teleop?.enabled),
    });
  });

  return serverInstance;
};

if (require.main === module) {
  bootstrap().catch((error) => {
    logger.error('Server failed to start', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

module.exports = { bootstrap };
