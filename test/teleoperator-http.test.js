const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { Pool } = require('pg');
const { Keypair } = require('@solana/web3.js');
const { ensureTeleoperatorSchema } = require('../src/db/ensureTeleoperatorSchema');
const createTeleoperatorRouter = require('../src/routes/teleoperator');

const connectionString = process.env.TEST_DATABASE_URL;
const run = connectionString ? describe : describe.skip;

run('teleoperator HTTP', () => {
  let pool;
  let app;

  before(async () => {
    pool = new Pool({ connectionString });
    await ensureTeleoperatorSchema(pool);
    await pool.query('TRUNCATE teleoperators');

    const config = {
      teleoperator: {
        jwtSecret: 'test-secret-key-for-jwt-signing',
        jwtExpiresIn: '1h',
        cookieName: 'teleop_token',
        bcryptRounds: 4,
      },
    };

    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use('/api/teleoperator', createTeleoperatorRouter({ pool, config }));
  });

  after(async () => {
    if (pool) {
      await pool.query('TRUNCATE teleoperators');
      await pool.end();
    }
  });

  test('register, me with cookie, logout, me without cookie', async () => {
    const walletPk = Keypair.generate().publicKey.toBase58();
    const agent = request.agent(app);

    const resReg = await agent
      .post('/api/teleoperator/register')
      .send({ login: 'httptest', password: 'password12', walletPublicKey: walletPk })
      .expect(201);
    assert.ok(resReg.body.user);
    assert.equal(resReg.body.user.login, 'httptest');

    const resMe = await agent.get('/api/teleoperator/me').expect(200);
    assert.equal(resMe.body.user.walletPublicKey, walletPk);

    await agent.post('/api/teleoperator/logout').expect(200);

    await request(app).get('/api/teleoperator/me').expect(401);
  });

  test('login with password', async () => {
    const walletPk = Keypair.generate().publicKey.toBase58();
    await request(app)
      .post('/api/teleoperator/register')
      .send({ login: 'loguser', password: 'password12', walletPublicKey: walletPk })
      .expect(201);

    const agent = request.agent(app);
    await agent
      .post('/api/teleoperator/login')
      .send({ login: 'loguser', password: 'password12' })
      .expect(200);

    const me = await agent.get('/api/teleoperator/me').expect(200);
    assert.equal(me.body.user.login, 'loguser');
  });
});
