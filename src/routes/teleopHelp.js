const express = require('express');
const { validate: validateUuid } = require('uuid');
const logger = require('../utils/logger');
const { constantTimeCompare } = require('../utils/secretCompare');
const {
  createHelpRequest,
  listOpenHelpRequestsForTeleoperator,
  getOpenHelpRequestMeta,
  acceptHelpRequest,
  updateHelpRequestPeaqClaim,
  getHelpRequestForRobotClaim,
} = require('../services/teleopHelpRepository');
const {
  normalizeRobotTeleopHelpBody,
  KyrPeaqContextTooLargeError,
  KyrPeaqContextInvalidError,
} = require('../utils/teleopHelpPayload');

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const PEAQ_RACE_TIMEOUT = Symbol('peaqRaceTimeout');

/**
 * @param {import('pg').Pool} pool
 * @param {{ buildClaim: Function }} peaqClaimService
 * @param {string} helpRequestId
 * @param {string} robotId
 */
async function persistPeaqClaim(pool, peaqClaimService, helpRequestId, robotId) {
  const claim = await peaqClaimService.buildClaim({ helpRequestId, robotId });
  await updateHelpRequestPeaqClaim(pool, { helpRequestId, claim });
  return claim;
}

function readRobotTeleopSecret(req) {
  const h = req.headers['x-robot-teleop-secret'];
  if (typeof h === 'string' && h.length > 0) {
    return h;
  }
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

/**
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @param {object} deps.registry - RobotRegistry instance
 * @param {object} deps.teleopHub - hub from createTeleopOperatorHub()
 * @param {import('express').RequestHandler} deps.attachTeleopUser
 * @param {import('express').RequestHandler} deps.requireTeleopSession
 * @param {ReturnType<import('../services/teleoperatorRobotGrantRepository').createTeleoperatorRobotGrantRepository>|null} [deps.grantRepository]
 * @param {{ isEnabled: () => boolean, buildClaim: (input: { helpRequestId: string, robotId: string }) => Promise<object> }|null} [deps.peaqClaimService]
 * @param {number} [deps.peaqClaimSyncTimeoutMs]
 */
function createTeleopHelpRouter({
  pool,
  registry,
  teleopHub,
  attachTeleopUser,
  requireTeleopSession,
  grantRepository = null,
  peaqClaimService = null,
  peaqClaimSyncTimeoutMs = 2500,
}) {
  const router = express.Router();

  /**
   * @openapi
   * /api/robots/{robotId}/teleop/help:
   *   post:
   *     tags:
   *       - Teleop
   *     summary: Robot requests operator assistance (LAN, shared secret)
   *     description: Requires X-Robot-Teleop-Secret matching the value set when the robot was registered. Body must include string `message`. `metadata` is normalized — `task_id`, `error_context`, `situation_report` are strings (default empty); optional `situation_report` is UTF-8 narrative, max ~64 KiB (truncated). Optional opaque object `metadata.kyr_peaq_context` for peaq (max 64 KiB JSON). Legacy clients may omit `metadata`. If an open request already exists for this robot, returns that request with duplicate=true. Response includes top-level `id` (same as `helpRequest.id`) for claim polling. When **PEAQ_ENABLED** and RPC/DID env are set, the server may include `peaq_claim` inline (if `did.read` finishes within **PEAQ_CLAIM_SYNC_TIMEOUT_MS**); otherwise use **GET /api/robots/{robotId}/peaq/claim**. WebSocket event `help_request` is sent only to teleoperators with an active grant for this robot when the robot has at least one grant; otherwise to all connected teleoperators.
   *     parameters:
   *       - in: path
   *         name: robotId
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/RobotTeleopHelpRequest'
   *     responses:
   *       200:
   *         description: Help request created or existing open request returned.
   *       201:
   *         description: New help request created (same body shape as 200).
   *       400:
   *         description: Invalid JSON body (e.g. missing or non-string `message`, or invalid `kyr_peaq_context` type).
   *       401:
   *         description: Missing or invalid robot secret.
   *       404:
   *         description: Robot not found in registry.
   *       413:
   *         description: metadata.kyr_peaq_context JSON exceeds 64 KiB.
   */
  router.post('/robots/:robotId/teleop/help', async (req, res) => {
    try {
      const { robotId } = req.params;
      const robot = registry.getById(robotId);
      if (!robot) {
        return res.status(404).json({ error: 'Robot not found' });
      }
      if (!robot.teleopSecret) {
        return res.status(401).json({ error: 'Teleop secret not configured for this robot' });
      }
      const secret = readRobotTeleopSecret(req);
      if (!secret || !constantTimeCompare(secret, robot.teleopSecret)) {
        return res.status(401).json({ error: 'Invalid or missing X-Robot-Teleop-Secret' });
      }

      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      if (typeof body.message !== 'string') {
        return res.status(400).json({ error: 'message is required and must be a string' });
      }
      const payload = normalizeRobotTeleopHelpBody(body);

      const { row, duplicate } = await createHelpRequest(pool, {
        robotId,
        payload,
      });

      let peaq_claim = null;
      if (peaqClaimService && peaqClaimService.isEnabled()) {
        if (row.peaq_claim) {
          peaq_claim = row.peaq_claim;
        } else {
          const timeoutMs = peaqClaimSyncTimeoutMs;
          const buildPromise = persistPeaqClaim(pool, peaqClaimService, row.id, robotId).catch((err) => {
            logger.error('peaq claim build failed', { error: err.message, helpRequestId: row.id });
            return null;
          });
          const raced = await Promise.race([
            buildPromise,
            sleep(timeoutMs).then(() => PEAQ_RACE_TIMEOUT),
          ]);
          if (raced !== PEAQ_RACE_TIMEOUT && raced != null) {
            peaq_claim = raced;
          }
        }
      }

      const event = {
        type: 'help_request',
        data: {
          id: row.id,
          robotId: row.robot_id,
          status: row.status,
          payload: row.payload,
          createdAt: row.created_at,
          duplicate,
        },
      };
      let allowedIds = null;
      if (grantRepository) {
        const grantCount = await grantRepository.countActiveGrantsForRobot(robotId);
        if (grantCount > 0) {
          allowedIds = await grantRepository.listActiveTeleoperatorIdsForRobot(robotId);
        }
      }
      teleopHub.broadcastHelpRequest(event, { allowedTeleoperatorIds: allowedIds });

      const statusCode = duplicate ? 200 : 201;
      const jsonBody = {
        id: row.id,
        helpRequest: {
          id: row.id,
          robotId: row.robot_id,
          status: row.status,
          payload: row.payload,
          createdAt: row.created_at,
        },
        duplicate,
      };
      if (peaq_claim != null) {
        jsonBody.peaq_claim = peaq_claim;
      }
      return res.status(statusCode).json(jsonBody);
    } catch (error) {
      if (error instanceof KyrPeaqContextTooLargeError) {
        return res.status(413).json({ error: error.message });
      }
      if (error instanceof KyrPeaqContextInvalidError) {
        return res.status(400).json({ error: error.message });
      }
      logger.error('teleop help create failed', { error: error.message });
      return res.status(500).json({ error: 'Failed to create help request' });
    }
  });

  /**
   * @openapi
   * /api/robots/{robotId}/peaq/claim:
   *   get:
   *     tags:
   *       - Teleop
   *     summary: Fetch peaq claim for a help request (robot secret)
   *     description: >
   *       Same authentication as POST teleop/help (header X-Robot-Teleop-Secret or Bearer).
   *       Query helpRequestId must match the id from the help response.
   *       Returns 404 with error claim_not_ready until the claim is stored (e.g. async did.read after POST).
   *     parameters:
   *       - in: path
   *         name: robotId
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *       - in: query
   *         name: helpRequestId
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     responses:
   *       200:
   *         description: Claim available.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 peaq_claim:
   *                   $ref: '#/components/schemas/PeaqClaim'
   *       400:
   *         description: Missing or invalid helpRequestId.
   *       401:
   *         description: Invalid or missing robot secret.
   *       404:
   *         description: Robot not found, help request not found for this robot, or claim not ready yet.
   */
  router.get('/robots/:robotId/peaq/claim', async (req, res) => {
    try {
      const { robotId } = req.params;
      const robot = registry.getById(robotId);
      if (!robot) {
        return res.status(404).json({ error: 'Robot not found' });
      }
      if (!robot.teleopSecret) {
        return res.status(401).json({ error: 'Teleop secret not configured for this robot' });
      }
      const secret = readRobotTeleopSecret(req);
      if (!secret || !constantTimeCompare(secret, robot.teleopSecret)) {
        return res.status(401).json({ error: 'Invalid or missing X-Robot-Teleop-Secret' });
      }
      const helpRequestId = req.query.helpRequestId;
      if (helpRequestId == null || helpRequestId === '') {
        return res.status(400).json({ error: 'helpRequestId query parameter is required' });
      }
      if (typeof helpRequestId !== 'string' || !validateUuid(helpRequestId)) {
        return res.status(400).json({ error: 'helpRequestId must be a valid UUID' });
      }
      const rec = await getHelpRequestForRobotClaim(pool, { helpRequestId, robotId });
      if (!rec || rec.peaq_claim == null) {
        return res.status(404).json({ error: 'claim_not_ready' });
      }
      return res.json({ peaq_claim: rec.peaq_claim });
    } catch (error) {
      logger.error('peaq claim fetch failed', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch peaq claim' });
    }
  });

  const teleopOnly = express.Router();
  teleopOnly.use(attachTeleopUser);
  teleopOnly.use(requireTeleopSession);

  /**
   * @openapi
   * /api/teleoperator/help-requests:
   *   get:
   *     tags:
   *       - Teleop
   *     summary: List open help requests visible to the current operator
   *     description: Includes open requests for robots with no active teleoperator_robot_grants (any logged-in operator), and for robots where this operator has an active grant. Each item `payload` includes `message` and `metadata` with `task_id`, `error_context`, `situation_report` (and any extra keys the robot sent).
   *     security:
   *       - TeleoperatorCookie: []
   *       - TeleoperatorBearer: []
   *     responses:
   *       200:
   *         description: Open help requests (sorted by created_at ASC).
   *       401:
   *         description: Not authenticated.
   */
  teleopOnly.get('/help-requests', async (req, res) => {
    try {
      const rows = await listOpenHelpRequestsForTeleoperator(pool, req.teleopUser.id);
      return res.json({
        helpRequests: rows.map((row) => ({
          id: row.id,
          robotId: row.robot_id,
          status: row.status,
          payload: row.payload,
          createdAt: row.created_at,
        })),
      });
    } catch (error) {
      logger.error('list help requests failed', { error: error.message });
      return res.status(500).json({ error: 'Failed to list help requests' });
    }
  });

  /**
   * @openapi
   * /api/teleoperator/help-requests/{id}/accept:
   *   post:
   *     tags:
   *       - Teleop
   *     summary: Accept a help request and create a teleop proxy session
   *     security:
   *       - TeleoperatorCookie: []
   *       - TeleoperatorBearer: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     responses:
   *       200:
   *         description: Session created; use WebSocket /ws/teleop/session/{sessionId}?token=JWT
   *       401:
   *         description: Not authenticated.
   *       403:
   *         description: Operator has no grant for this robot (when the robot has at least one active grant).
   *       409:
   *         description: Request already claimed or not open.
   */
  teleopOnly.post('/help-requests/:id/accept', async (req, res) => {
    try {
      const teleoperatorId = req.teleopUser.id;
      const meta = await getOpenHelpRequestMeta(pool, req.params.id);
      if (!meta) {
        return res.status(409).json({ error: 'Help request is not open or was already claimed' });
      }
      if (grantRepository) {
        const grantCount = await grantRepository.countActiveGrantsForRobot(meta.robot_id);
        if (grantCount > 0) {
          const allowed = await grantRepository.hasActiveGrant({
            teleoperatorId,
            robotId: meta.robot_id,
          });
          if (!allowed) {
            return res.status(403).json({ error: 'Operator not authorized for this robot' });
          }
        }
      }
      const result = await acceptHelpRequest(pool, {
        requestId: req.params.id,
        teleoperatorId,
      });
      if (!result) {
        return res.status(409).json({ error: 'Help request is not open or was already claimed' });
      }
      return res.json({
        ok: true,
        helpRequest: {
          id: result.helpRequest.id,
          robotId: result.helpRequest.robot_id,
          status: result.helpRequest.status,
        },
        session: {
          id: result.session.id,
          robotId: result.session.robot_id,
          createdAt: result.session.created_at,
        },
      });
    } catch (error) {
      logger.error('accept help request failed', { error: error.message });
      return res.status(500).json({ error: 'Failed to accept help request' });
    }
  });

  // Mount only under /teleoperator so /api/robots/* (e.g. enroll) is not caught by requireTeleopSession.
  router.use('/teleoperator', teleopOnly);

  return router;
}

module.exports = createTeleopHelpRouter;
