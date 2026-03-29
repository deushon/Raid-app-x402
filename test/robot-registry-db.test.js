const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const RobotRegistry = require('../src/services/robotRegistry');
const { createRobotRepository } = require('../src/services/robotRepository');
const { ensureRobotSchema } = require('../src/db/ensureRobotSchema');
const { ensureTeleoperatorSchema } = require('../src/db/ensureTeleoperatorSchema');
const { ensureTeleopHelpSchema } = require('../src/db/ensureTeleopHelpSchema');
const createHealthMonitor = require('../src/services/healthMonitor');
const X402Service = require('../src/services/x402Service');
const { loadConfig } = require('../src/config');

const connectionString = process.env.TEST_DATABASE_URL;
const run = connectionString ? describe : describe.skip;

run('robot registry PostgreSQL', () => {
  let pool;

  before(async () => {
    pool = new Pool({ connectionString });
    await ensureTeleoperatorSchema(pool);
    await ensureTeleopHelpSchema(pool);
    await ensureRobotSchema(pool);
    await pool.query('DELETE FROM robots');
  });

  after(async () => {
    if (pool) {
      await pool.query('DELETE FROM robots');
      await pool.end();
    }
  });

  test('add persists; second registry loadFromPersistence sees robot', async () => {
    const config = loadConfig([]);
    const x402Service = new X402Service(config.x402);
    const healthMonitor = createHealthMonitor({ config, x402Service });
    const repo = createRobotRepository(pool);

    const reg1 = new RobotRegistry({ healthMonitor, robotRepository: repo });
    await reg1.loadFromPersistence();
    const created = await reg1.addRobot({
      name: 'db-bot',
      host: '10.0.0.1',
      port: 18080,
      teleopSecret: 'sec-db-test',
    });
    const id = created.id;

    const reg2 = new RobotRegistry({ healthMonitor, robotRepository: repo });
    await reg2.loadFromPersistence();
    assert.equal(reg2.list().length, 1);
    const again = reg2.getById(id);
    assert.ok(again);
    assert.equal(again.name, 'db-bot');
    assert.equal(again.host, '10.0.0.1');
    assert.equal(again.port, 18080);
    assert.equal(again.teleopSecret, 'sec-db-test');

    const removed = await reg2.removeRobot(id);
    assert.equal(removed, true);
    const reg3 = new RobotRegistry({ healthMonitor, robotRepository: repo });
    await reg3.loadFromPersistence();
    assert.equal(reg3.list().length, 0);
  });

  test('updateRobot writes through to DB', async () => {
    const config = loadConfig([]);
    const x402Service = new X402Service(config.x402);
    const healthMonitor = createHealthMonitor({ config, x402Service });
    const repo = createRobotRepository(pool);
    const reg = new RobotRegistry({ healthMonitor, robotRepository: repo });
    await reg.loadFromPersistence();
    const r = await reg.addRobot({ name: 'u1', host: '1.1.1.1', port: 1 });
    await reg.updateRobot(r.id, { name: 'u2', host: '2.2.2.2', port: 2 });
    const reg2 = new RobotRegistry({ healthMonitor, robotRepository: repo });
    await reg2.loadFromPersistence();
    const loaded = reg2.getById(r.id);
    assert.equal(loaded.name, 'u2');
    assert.equal(loaded.host, '2.2.2.2');
    assert.equal(loaded.port, 2);
    await reg2.removeRobot(r.id);
  });
});
