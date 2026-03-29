const logger = require('./logger');

/** Max UTF-8 bytes for `metadata.situation_report` (spec: ~32–64 KiB). */
const MAX_SITUATION_REPORT_BYTES = 65536;

/**
 * Truncate a string so its UTF-8 byte length is at most `maxBytes`, without splitting a code point.
 * @param {string} str
 * @param {number} maxBytes
 * @returns {string}
 */
function truncateUtf8(str, maxBytes) {
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) {
    return str;
  }
  let len = maxBytes;
  // Drop trailing bytes that would split a code point (first excluded byte is UTF-8 continuation).
  while (len > 0 && len < buf.length && (buf[len] & 0xc0) === 0x80) {
    len -= 1;
  }
  return buf.subarray(0, len).toString('utf8');
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function coerceMetadataString(v) {
  if (typeof v === 'string') {
    return v;
  }
  if (v != null && (typeof v === 'number' || typeof v === 'boolean')) {
    return String(v);
  }
  return '';
}

/**
 * Normalize robot POST …/teleop/help body per RAID_APP_TELEOP_HELP_SPEC.md.
 * `message` must be a string (caller validates).
 * Missing `metadata` or keys → empty strings; extra keys preserved under `metadata`.
 * `situation_report` truncated at MAX_SITUATION_REPORT_BYTES UTF-8 with a warning log.
 *
 * @param {object} body - parsed JSON object
 * @returns {{ message: string, metadata: Record<string, unknown> }}
 */
function normalizeRobotTeleopHelpBody(body) {
  const message = body.message;
  const rawMeta =
    body.metadata != null && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? { ...body.metadata }
      : {};

  const task_id = coerceMetadataString(rawMeta.task_id);
  const error_context = coerceMetadataString(rawMeta.error_context);
  let situation_report = coerceMetadataString(rawMeta.situation_report);

  delete rawMeta.task_id;
  delete rawMeta.error_context;
  delete rawMeta.situation_report;

  const srBytes = Buffer.byteLength(situation_report, 'utf8');
  if (srBytes > MAX_SITUATION_REPORT_BYTES) {
    logger.warn('metadata.situation_report truncated to max UTF-8 length', {
      byteLength: srBytes,
      maxBytes: MAX_SITUATION_REPORT_BYTES,
    });
    situation_report = truncateUtf8(situation_report, MAX_SITUATION_REPORT_BYTES);
  }

  return {
    message,
    metadata: {
      ...rawMeta,
      task_id,
      error_context,
      situation_report,
    },
  };
}

module.exports = {
  MAX_SITUATION_REPORT_BYTES,
  normalizeRobotTeleopHelpBody,
  truncateUtf8,
};
