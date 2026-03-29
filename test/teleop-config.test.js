const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

describe('teleop config env', () => {
  const backup = {};

  beforeEach(() => {
    const keys = [
      'TELEOP_SESSION_END_GRACE_MS',
      'TELEOP_ROSBRIDGE_CONNECT_ATTEMPTS',
      'TELEOP_ROSBRIDGE_RECONNECT_DELAY_MS',
      'TELEOP_ROSBRIDGE_DROP_RECONNECT_ATTEMPTS',
    ];
    keys.forEach((k) => {
      backup[k] = process.env[k];
      delete process.env[k];
    });
  });

  afterEach(() => {
    Object.keys(backup).forEach((k) => {
      if (backup[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = backup[k];
      }
    });
  });

  test('teleop session/rosbridge options are numeric (defaults or .env)', () => {
    const c = loadConfig([]);
    assert.ok(Number.isFinite(c.teleop.sessionEndGraceMs) && c.teleop.sessionEndGraceMs >= 0);
    assert.ok(Number.isFinite(c.teleop.rosbridgeConnectAttempts) && c.teleop.rosbridgeConnectAttempts >= 1);
    assert.ok(Number.isFinite(c.teleop.rosbridgeReconnectDelayMs) && c.teleop.rosbridgeReconnectDelayMs >= 0);
    assert.ok(
      Number.isFinite(c.teleop.rosbridgeDropReconnectAttempts)
        && c.teleop.rosbridgeDropReconnectAttempts >= 0,
    );
  });

  test('env overrides', () => {
    process.env.TELEOP_SESSION_END_GRACE_MS = '60000';
    process.env.TELEOP_ROSBRIDGE_CONNECT_ATTEMPTS = '5';
    process.env.TELEOP_ROSBRIDGE_RECONNECT_DELAY_MS = '500';
    process.env.TELEOP_ROSBRIDGE_DROP_RECONNECT_ATTEMPTS = '2';
    const c = loadConfig([]);
    assert.equal(c.teleop.sessionEndGraceMs, 60000);
    assert.equal(c.teleop.rosbridgeConnectAttempts, 5);
    assert.equal(c.teleop.rosbridgeReconnectDelayMs, 500);
    assert.equal(c.teleop.rosbridgeDropReconnectAttempts, 2);
  });
});
