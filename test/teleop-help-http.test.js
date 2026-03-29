const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { Pool } = require('pg');
const { Keypair } = require('@solana/web3.js');
const { ensureTeleoperatorSchema } = require('../src/db/ensureTeleoperatorSchema');
const { ensureTeleopHelpSchema } = require('../src/db/ensureTeleopHelpSchema');
const createTeleoperatorRouter = require('../src/routes/teleoperator');
const createTeleopHelpRouter = require('../src/routes/teleopHelp');
const createRobotsRouter = require('../src/routes/robots');
const RobotRegistry = require('../src/services/robotRegistry');
const createHealthMonitor = require('../src/services/healthMonitor');
const X402Service = require('../src/services/x402Service');
const { loadConfig } = require('../src/config');
const { createTeleopOperatorHub } = require('../src/services/teleopOperatorHub');
const {
  createAttachTeleopUser,
  createRequireTeleopSession,
} = require('../src/middleware/teleopSession');

const connectionString = process.env.TEST_DATABASE_URL;
const run = connectionString ? describe : describe.skip;

run('teleop help HTTP', () => {
  let pool;
  let app;
  let registry;
  const teleopSecret = 'test-teleop-secret-xyz';

  before(async () => {
    pool = new Pool({ connectionString });
    await ensureTeleoperatorSchema(pool);
    await ensureTeleopHelpSchema(pool);
    await pool.query('TRUNCATE teleop_sessions, help_requests, teleoperators RESTART IDENTITY CASCADE');

    const config = loadConfig([]);
    const x402Service = new X402Service(config.x402);
    const healthMonitor = createHealthMonitor({ config, x402Service });
    registry = new RobotRegistry({ healthMonitor });

    const teleopCfg = {
      teleoperator: {
        jwtSecret: 'test-secret-key-for-jwt-signing',
        jwtExpiresIn: '1h',
        cookieName: 'teleop_token',
        bcryptRounds: 4,
        cookieSecureMode: 'never',
      },
    };

    const attachTeleopUser = createAttachTeleopUser(teleopCfg.teleoperator);
    const teleopHub = createTeleopOperatorHub();

    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use('/api/robots', createRobotsRouter({ registry }));
    app.use('/api/teleoperator', createTeleoperatorRouter({ pool, config: teleopCfg }));
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
  });

  after(async () => {
    if (pool) {
      await pool.query('TRUNCATE teleop_sessions, help_requests, teleoperators RESTART IDENTITY CASCADE');
      await pool.end();
    }
  });

  test('help without secret 401; list and accept flow', async () => {
    const reg = await registry.addRobot({
      name: 'tbot',
      host: '127.0.0.1',
      port: 65534,
      teleopSecret,
    });
    const robotId = reg.id;

    await request(app)
      .post(`/api/robots/${robotId}/teleop/help`)
      .send({ message: 'need help' })
      .expect(401);

    const resHelp = await request(app)
      .post(`/api/robots/${robotId}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({ message: 'need help' })
      .expect(201);
    assert.equal(resHelp.body.duplicate, false);
    const helpId = resHelp.body.helpRequest.id;

    const walletPk = Keypair.generate().publicKey.toBase58();
    const agent = request.agent(app);
    await agent
      .post('/api/teleoperator/register')
      .send({ login: 'ophelp1', password: 'password12', walletPublicKey: walletPk })
      .expect(201);

    const list = await agent.get('/api/teleoperator/help-requests').expect(200);
    assert.equal(list.body.helpRequests.length, 1);
    assert.equal(list.body.helpRequests[0].id, helpId);

    const acc = await agent
      .post(`/api/teleoperator/help-requests/${helpId}/accept`)
      .expect(200);
    assert.ok(acc.body.session?.id);

    await agent.get('/api/teleoperator/help-requests').expect(200);
    assert.equal((await agent.get('/api/teleoperator/help-requests')).body.helpRequests.length, 0);
  });

  test('duplicate open help returns 200 and duplicate true', async () => {
    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65533,
      teleopSecret,
    });
    const r1 = await request(app)
      .post(`/api/robots/${reg.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .expect(201);
    const r2 = await request(app)
      .post(`/api/robots/${reg.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .expect(200);
    assert.equal(r2.body.duplicate, true);
    assert.equal(r2.body.helpRequest.id, r1.body.helpRequest.id);
  });

  test('second operator gets 409 on accept', async () => {
    await pool.query('TRUNCATE teleop_sessions, help_requests, teleoperators RESTART IDENTITY CASCADE');

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65532,
      teleopSecret,
    });
    const h = await request(app)
      .post(`/api/robots/${reg.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .expect(201);

    const w1 = Keypair.generate().publicKey.toBase58();
    const w2 = Keypair.generate().publicKey.toBase58();
    const a1 = request.agent(app);
    const a2 = request.agent(app);
    await a1
      .post('/api/teleoperator/register')
      .send({ login: 'opa', password: 'password12', walletPublicKey: w1 })
      .expect(201);
    await a2
      .post('/api/teleoperator/register')
      .send({ login: 'opb', password: 'password12', walletPublicKey: w2 })
      .expect(201);

    await a1.post(`/api/teleoperator/help-requests/${h.body.helpRequest.id}/accept`).expect(200);
    await a2.post(`/api/teleoperator/help-requests/${h.body.helpRequest.id}/accept`).expect(409);
  });
});
