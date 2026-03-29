const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { Pool } = require('pg');
const { Keypair } = require('@solana/web3.js');
const { ensureTeleoperatorSchema } = require('../src/db/ensureTeleoperatorSchema');
const { ensureTeleopHelpSchema } = require('../src/db/ensureTeleopHelpSchema');
const { ensureRobotSchema } = require('../src/db/ensureRobotSchema');
const { ensureTeleoperatorRobotGrantsSchema } = require('../src/db/ensureTeleoperatorRobotGrantsSchema');
const createTeleoperatorRouter = require('../src/routes/teleoperator');
const createTeleopHelpRouter = require('../src/routes/teleopHelp');
const createRobotsRouter = require('../src/routes/robots');
const RobotRegistry = require('../src/services/robotRegistry');
const createHealthMonitor = require('../src/services/healthMonitor');
const X402Service = require('../src/services/x402Service');
const { loadConfig } = require('../src/config');
const { createTeleopOperatorHub } = require('../src/services/teleopOperatorHub');
const { createRobotRepository } = require('../src/services/robotRepository');
const { createTeleoperatorRobotGrantRepository } = require('../src/services/teleoperatorRobotGrantRepository');
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
  let grantRepository;
  const teleopSecret = 'test-teleop-secret-xyz';
  const fleetSecret = 'fleet-teleop-help-test';

  before(async () => {
    process.env.ROBOT_FLEET_ENROLLMENT_SECRET = fleetSecret;
    process.env.ROBOT_HEALTH_TIMEOUT_MS = '400';
    pool = new Pool({ connectionString });
    await ensureTeleoperatorSchema(pool);
    await ensureTeleopHelpSchema(pool);
    await ensureRobotSchema(pool);
    await ensureTeleoperatorRobotGrantsSchema(pool);
    await pool.query(
      'TRUNCATE teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );

    const config = loadConfig([]);
    const x402Service = new X402Service(config.x402);
    const healthMonitor = createHealthMonitor({ config, x402Service });
    const robotRepository = createRobotRepository(pool);
    registry = new RobotRegistry({ healthMonitor, robotRepository });
    await registry.loadFromPersistence();
    grantRepository = createTeleoperatorRobotGrantRepository(pool);

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
    // Same order as src/index.js: /api teleop help before /api/robots so regressions match production.
    app.use('/api/teleoperator', createTeleoperatorRouter({ pool, config: teleopCfg }));
    app.use(
      '/api',
      createTeleopHelpRouter({
        pool,
        registry,
        teleopHub,
        attachTeleopUser,
        requireTeleopSession: createRequireTeleopSession({ mode: 'json' }),
        grantRepository,
      }),
    );
    app.use(
      '/api/robots',
      createRobotsRouter({
        registry,
        config,
        adminConfig: config.admin,
      }),
    );
  });

  after(async () => {
    if (pool) {
      await pool.query(
        'TRUNCATE teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
      );
      await pool.end();
    }
  });

  test('POST /api/robots/enroll reaches fleet auth after /api teleop mount (regression)', async () => {
    const bad = await request(app)
      .post('/api/robots/enroll')
      .send({ enrollmentKey: 'enroll-route-reg', host: '127.0.0.1', port: 49001 })
      .expect(401);
    assert.notEqual(bad.body.error, 'Unauthorized');
    assert.match(String(bad.body.error || ''), /fleet|credential/i);

    const ok = await request(app)
      .post('/api/robots/enroll')
      .set('X-Robot-Fleet-Secret', fleetSecret)
      .send({ enrollmentKey: 'enroll-route-reg', host: '127.0.0.1', port: 49002 })
      .expect(200);
    assert.ok(ok.body.id);
    assert.ok(ok.body.teleopSecret);
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

    await request(app)
      .post(`/api/robots/${robotId}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({})
      .expect(400);

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
    const p = list.body.helpRequests[0].payload;
    assert.equal(p.message, 'need help');
    assert.equal(p.metadata.task_id, '');
    assert.equal(p.metadata.error_context, '');
    assert.equal(p.metadata.situation_report, '');

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
    await pool.query(
      'TRUNCATE teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

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

  test('accept 403 when another operator has grant but not this one', async () => {
    await pool.query(
      'TRUNCATE teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65530,
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
    const reg1 = await a1
      .post('/api/teleoperator/register')
      .send({ login: 'opx1', password: 'password12', walletPublicKey: w1 })
      .expect(201);
    await a2
      .post('/api/teleoperator/register')
      .send({ login: 'opx2', password: 'password12', walletPublicKey: w2 })
      .expect(201);

    await grantRepository.grant({ teleoperatorId: reg1.body.user.id, robotId: reg.id });

    const listDenied = await a2.get('/api/teleoperator/help-requests').expect(200);
    assert.equal(listDenied.body.helpRequests.length, 0);
    const listGranted = await a1.get('/api/teleoperator/help-requests').expect(200);
    assert.equal(listGranted.body.helpRequests.length, 1);
    assert.equal(listGranted.body.helpRequests[0].id, h.body.helpRequest.id);

    await a2.post(`/api/teleoperator/help-requests/${h.body.helpRequest.id}/accept`).expect(403);
  });

  test('help list shows granted robot only to granted operator; open robot to all', async () => {
    await pool.query(
      'TRUNCATE teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const rGranted = await registry.addRobot({
      host: '127.0.0.1',
      port: 65528,
      teleopSecret,
    });
    const rOpen = await registry.addRobot({
      host: '127.0.0.1',
      port: 65527,
      teleopSecret,
    });

    const w1 = Keypair.generate().publicKey.toBase58();
    const w2 = Keypair.generate().publicKey.toBase58();
    const a1 = request.agent(app);
    const a2 = request.agent(app);
    const reg1 = await a1
      .post('/api/teleoperator/register')
      .send({ login: 'mix1', password: 'password12', walletPublicKey: w1 })
      .expect(201);
    await a2
      .post('/api/teleoperator/register')
      .send({ login: 'mix2', password: 'password12', walletPublicKey: w2 })
      .expect(201);

    await grantRepository.grant({ teleoperatorId: reg1.body.user.id, robotId: rGranted.id });

    await request(app)
      .post(`/api/robots/${rGranted.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .expect(201);
    const hOpen = await request(app)
      .post(`/api/robots/${rOpen.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .expect(201);

    const l1 = await a1.get('/api/teleoperator/help-requests').expect(200);
    assert.equal(l1.body.helpRequests.length, 2);

    const l2 = await a2.get('/api/teleoperator/help-requests').expect(200);
    assert.equal(l2.body.helpRequests.length, 1);
    assert.equal(l2.body.helpRequests[0].id, hOpen.body.helpRequest.id);
  });

  test('help payload includes situation_report for operator list', async () => {
    await pool.query(
      'TRUNCATE teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65526,
      teleopSecret,
    });
    const sr = 'Stuck near obstacle; last cmd was nav_goal.';
    await request(app)
      .post(`/api/robots/${reg.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({
        message: 'Need assistance',
        metadata: {
          task_id: 'sess-9',
          error_context: '{"n":1}',
          situation_report: sr,
        },
      })
      .expect(201);

    const w = Keypair.generate().publicKey.toBase58();
    const agent = request.agent(app);
    await agent
      .post('/api/teleoperator/register')
      .send({ login: 'opsr', password: 'password12', walletPublicKey: w })
      .expect(201);
    const list = await agent.get('/api/teleoperator/help-requests').expect(200);
    assert.equal(list.body.helpRequests.length, 1);
    const p = list.body.helpRequests[0].payload;
    assert.equal(p.metadata.task_id, 'sess-9');
    assert.equal(p.metadata.error_context, '{"n":1}');
    assert.equal(p.metadata.situation_report, sr);
  });

  test('grantRepository listActive exposes teleoperator_login (login_normalized)', async () => {
    await pool.query(
      'TRUNCATE teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65529,
      teleopSecret,
    });
    const w = Keypair.generate().publicKey.toBase58();
    const regOp = await request(app)
      .post('/api/teleoperator/register')
      .send({ login: 'ListGrantUser', password: 'password12', walletPublicKey: w })
      .expect(201);
    await grantRepository.grant({ teleoperatorId: regOp.body.user.id, robotId: reg.id });
    const rows = await grantRepository.listActive();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].teleoperator_login, 'listgrantuser');
  });
});
