const axios = require('axios');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');
const servicesRegistrationStore = require('../services/servicesRegistrationStore');
const { DEFAULT_BATCH_PATH } = require('../services/dataNodeSyncProvision');

/**
 * @param {string} base
 * @param {string} batchPath
 */
function joinBaseAndPath(base, batchPath) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  const p = String(batchPath || DEFAULT_BATCH_PATH).trim();
  const pathPart = p.startsWith('/') ? p : `/${p}`;
  return `${b}${pathPart}`;
}

/**
 * @param {string|null|undefined} robotId
 */
function buildProbeBatch(robotId) {
  const ts = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    kyrRobotId: 'raid_probe',
    raidRobotUuid: robotId != null ? String(robotId) : '',
    batchId: randomUUID(),
    sentAtUtc: ts,
    events: [
      {
        eventUid: randomUUID(),
        source: 'kyr_dashboard',
        occurredAt: ts,
        kind: 'session_open',
        summary: 'RAID services-registration connectivity probe',
        metadata: { probe: true, session_id: 'raid-probe' },
      },
    ],
  };
}

/**
 * Resolve fleet fields for a probe (saved merge vs inline override).
 * @param {object} config
 * @param {object} body
 */
function resolveFleetForProbe(config, body) {
  const useSaved = body?.useSaved !== false;
  const over = body?.override && typeof body.override === 'object' && !Array.isArray(body.override)
    ? body.override
    : {};
  const merged = useSaved
    ? servicesRegistrationStore.getMergedDataNodeSyncFleet(config)
    : {};
  const baseUrl = String(over.baseUrl ?? merged.baseUrl ?? '').trim();
  const batchPath = String(over.batchPath ?? merged.batchPath ?? DEFAULT_BATCH_PATH).trim();
  const authHeaderName = String(
    over.authHeaderName ?? merged.authHeaderName ?? 'Authorization',
  ).trim() || 'Authorization';
  let authHeaderValue = '';
  if (over.authHeaderValue != null && String(over.authHeaderValue).trim() !== '') {
    authHeaderValue = String(over.authHeaderValue).trim();
  } else if (merged.authHeaderValue != null && String(merged.authHeaderValue).trim() !== '') {
    authHeaderValue = String(merged.authHeaderValue).trim();
  }
  return { baseUrl, batchPath, authHeaderName, authHeaderValue };
}

/**
 * @param {import('express').Router} router
 * @param {{ config: object, registry: object|null }} deps
 */
function registerAdminServicesRegistrationRoutes(router, { config, registry }) {
  /**
   * @openapi
   * /api/admin/services-registration:
   *   get:
   *     tags:
   *       - Admin
   *     summary: Services registration (masked secrets + effective preview)
   *     description: Includes **fleetEnrollmentSecret** (plain string or null) for dashboard QR/copy; env overrides file. Other secrets stay boolean flags only.
   *     security:
   *       - AdminSessionCookie: []
   *       - AdminBasic: []
   */
  router.get('/services-registration', (req, res) => {
    try {
      res.json(servicesRegistrationStore.getAdminView(config));
    } catch (error) {
      logger.error('services-registration get failed', { error: error.message });
      res.status(500).json({ error: 'Failed to read registration state' });
    }
  });

  /**
   * @openapi
   * /api/admin/services-registration:
   *   put:
   *     tags:
   *       - Admin
   *     summary: Update services-registration file (secrets optional; omit auth fields to keep)
   *     security:
   *       - AdminSessionCookie: []
   *       - AdminBasic: []
   */
  router.put('/services-registration', (req, res) => {
    try {
      servicesRegistrationStore.saveFromAdminBody(req.body || {});
      res.json({ ok: true, ...servicesRegistrationStore.getAdminView(config) });
    } catch (error) {
      logger.error('services-registration put failed', { error: error.message });
      res.status(400).json({ error: error.message || 'Invalid body' });
    }
  });

  /**
   * @openapi
   * /api/admin/services-registration/test-data-node:
   *   post:
   *     tags:
   *       - Admin
   *     summary: POST a minimal normative batch envelope to DATA_NODE (connectivity probe)
   *     security:
   *       - AdminSessionCookie: []
   *       - AdminBasic: []
   */
  router.post('/services-registration/test-data-node', async (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const { baseUrl, batchPath, authHeaderName, authHeaderValue } = resolveFleetForProbe(config, body);
    if (!baseUrl) {
      return res.status(400).json({
        error: 'baseUrl is required (set in UI / env DATA_NODE_SYNC_BASE_URL, or pass override.baseUrl with useSaved:false)',
      });
    }
    const url = joinBaseAndPath(baseUrl, batchPath);
    const probeBody = buildProbeBatch(body.robotId);
    /** @type {Record<string, string>} */
    const headers = { 'Content-Type': 'application/json' };
    if (authHeaderValue) {
      headers[authHeaderName] = authHeaderValue;
    }
    try {
      const resp = await axios.post(url, probeBody, {
        headers,
        timeout: 15000,
        validateStatus: () => true,
      });
      const ok = resp.status >= 200 && resp.status < 300;
      return res.status(200).json({
        ok,
        requestUrl: url,
        status: resp.status,
        responseBody: resp.data,
      });
    } catch (error) {
      logger.warn('test-data-node failed', { url, error: error.message });
      return res.status(200).json({
        ok: false,
        requestUrl: url,
        error: error.message,
      });
    }
  });

  /**
   * @openapi
   * /api/admin/services-registration/test-robot-registry:
   *   post:
   *     tags:
   *       - Admin
   *     summary: POST empty JSON to robot operatorRegistryUrl (reachability + RAID secret)
   *     security:
   *       - AdminSessionCookie: []
   *       - AdminBasic: []
   */
  router.post('/services-registration/test-robot-registry', async (req, res) => {
    if (!registry) {
      return res.status(503).json({ error: 'Robot registry not available' });
    }
    const robotId = req.body?.robotId;
    if (typeof robotId !== 'string' || !robotId.trim()) {
      return res.status(400).json({ error: 'robotId is required' });
    }
    const robot = registry.getById(robotId.trim());
    if (!robot) {
      return res.status(404).json({ error: 'Robot not found' });
    }
    const regUrl = robot.operatorRegistryUrl;
    if (!regUrl || String(regUrl).trim() === '') {
      return res.status(400).json({ error: 'Robot has no operatorRegistryUrl' });
    }
    const secret = servicesRegistrationStore.getEffectiveRaidToRobotSecret(config);
    if (!secret) {
      return res.status(400).json({
        error: 'RAID_TO_ROBOT_SECRET not set (env or services-registration file)',
      });
    }
    try {
      const resp = await axios.post(String(regUrl).trim(), {}, {
        headers: {
          'Content-Type': 'application/json',
          'X-Raid-To-Robot-Secret': secret,
        },
        timeout: 12000,
        validateStatus: () => true,
      });
      const reachable = resp.status < 500;
      return res.status(200).json({
        ok: reachable,
        requestUrl: String(regUrl).trim(),
        status: resp.status,
        responseBody: resp.data,
        note:
          '4xx often means the endpoint is reachable but rejects an empty body; 5xx or network error means failure.',
      });
    } catch (error) {
      logger.warn('test-robot-registry failed', { robotId, error: error.message });
      return res.status(200).json({
        ok: false,
        requestUrl: String(regUrl).trim(),
        error: error.message,
      });
    }
  });
}

module.exports = { registerAdminServicesRegistrationRoutes };
