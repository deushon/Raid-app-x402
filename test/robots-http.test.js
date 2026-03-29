const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const createRobotsRouter = require('../src/routes/robots');
const RobotRegistry = require('../src/services/robotRegistry');
const createHealthMonitor = require('../src/services/healthMonitor');
const X402Service = require('../src/services/x402Service');
const { loadConfig } = require('../src/config');

describe('robots HTTP', () => {
  let app;
  let registry;

  before(() => {
    const config = loadConfig([]);
    const x402Service = new X402Service(config.x402);
    const healthMonitor = createHealthMonitor({ config, x402Service });
    registry = new RobotRegistry({ healthMonitor });
    app = express();
    app.use(express.json());
    app.use('/api/robots', createRobotsRouter({ registry }));
  });

  test('GET /api/robots returns empty list initially', async () => {
    const res = await request(app).get('/api/robots').expect(200);
    assert.deepEqual(res.body, { robots: [] });
  });

  test('GET /api/robots returns registered robot with teleopSecret', async () => {
    const secret = 'list-me-on-get';
    const created = await registry.addRobot({
      name: 'test1',
      host: '127.0.0.1',
      port: 65533,
      teleopSecret: secret,
    });

    const res = await request(app).get('/api/robots').expect(200);
    assert.equal(res.body.robots.length, 1);
    const r = res.body.robots[0];
    assert.equal(r.id, created.id);
    assert.equal(r.name, 'test1');
    assert.equal(r.host, '127.0.0.1');
    assert.equal(r.port, 65533);
    assert.equal(r.teleopSecret, secret);
    assert.ok(r.status && typeof r.status.state === 'string');
  });
});
