const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_SITUATION_REPORT_BYTES,
  normalizeRobotTeleopHelpBody,
  truncateUtf8,
} = require('../src/utils/teleopHelpPayload');

test('normalizeRobotTeleopHelpBody fills metadata strings and preserves extra keys', () => {
  const out = normalizeRobotTeleopHelpBody({
    message: 'Need assistance',
    metadata: { task_id: 't1', error_context: '', battery: 12 },
  });
  assert.equal(out.message, 'Need assistance');
  assert.equal(out.metadata.task_id, 't1');
  assert.equal(out.metadata.error_context, '');
  assert.equal(out.metadata.situation_report, '');
  assert.equal(out.metadata.battery, 12);
});

test('normalizeRobotTeleopHelpBody omits situation_report key → empty string', () => {
  const out = normalizeRobotTeleopHelpBody({
    message: 'x',
    metadata: { task_id: 'a', error_context: 'err' },
  });
  assert.equal(out.metadata.situation_report, '');
});

test('normalizeRobotTeleopHelpBody missing metadata → empty standard fields', () => {
  const out = normalizeRobotTeleopHelpBody({ message: 'only' });
  assert.equal(out.metadata.task_id, '');
  assert.equal(out.metadata.error_context, '');
  assert.equal(out.metadata.situation_report, '');
});

test('truncateUtf8 does not split UTF-8 code point', () => {
  const s = 'ééé'; // U+00E9 → 2 bytes per char in UTF-8
  const t = truncateUtf8(s, 3);
  assert.equal(t, 'é');
  assert.equal(Buffer.byteLength(t, 'utf8'), 2);
});

test('situation_report truncated at MAX_SITUATION_REPORT_BYTES', () => {
  const report = 'a'.repeat(MAX_SITUATION_REPORT_BYTES + 100);
  const out = normalizeRobotTeleopHelpBody({
    message: 'm',
    metadata: { task_id: '', error_context: '', situation_report: report },
  });
  assert.equal(Buffer.byteLength(out.metadata.situation_report, 'utf8'), MAX_SITUATION_REPORT_BYTES);
});
