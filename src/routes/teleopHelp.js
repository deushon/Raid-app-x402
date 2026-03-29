const express = require('express');
const crypto = require('crypto');
const logger = require('../utils/logger');
const {
  createHelpRequest,
  listOpenHelpRequests,
  acceptHelpRequest,
} = require('../services/teleopHelpRepository');

function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
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
 */
function createTeleopHelpRouter({
  pool,
  registry,
  teleopHub,
  attachTeleopUser,
  requireTeleopSession,
}) {
  const router = express.Router();

  /**
   * @openapi
   * /api/robots/{robotId}/teleop/help:
   *   post:
   *     tags:
   *       - Teleop
   *     summary: Robot requests operator assistance (LAN, shared secret)
   *     description: Requires X-Robot-Teleop-Secret matching the value set when the robot was registered. If an open request already exists for this robot, returns that request with duplicate=true.
   *     parameters:
   *       - in: path
   *         name: robotId
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               message:
   *                 type: string
   *               metadata:
   *                 type: object
   *                 additionalProperties: true
   *     responses:
   *       200:
   *         description: Help request created or existing open request returned.
   *       401:
   *         description: Missing or invalid robot secret.
   *       404:
   *         description: Robot not found in registry.
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

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const payload = {};
      if (typeof body.message === 'string') {
        payload.message = body.message;
      }
      if (body.metadata != null && typeof body.metadata === 'object') {
        payload.metadata = body.metadata;
      }

      const { row, duplicate } = await createHelpRequest(pool, {
        robotId,
        payload: Object.keys(payload).length ? payload : null,
      });

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
      teleopHub.broadcast(event);

      const statusCode = duplicate ? 200 : 201;
      return res.status(statusCode).json({
        helpRequest: {
          id: row.id,
          robotId: row.robot_id,
          status: row.status,
          payload: row.payload,
          createdAt: row.created_at,
        },
        duplicate,
      });
    } catch (error) {
      logger.error('teleop help create failed', { error: error.message });
      return res.status(500).json({ error: 'Failed to create help request' });
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
   *     summary: List open help requests
   *     security:
   *       - TeleoperatorCookie: []
   *       - TeleoperatorBearer: []
   *     responses:
   *       200:
   *         description: Open help requests (newest last in array; sorted by created_at ASC).
   *       401:
   *         description: Not authenticated.
   */
  teleopOnly.get('/teleoperator/help-requests', async (req, res) => {
    try {
      const rows = await listOpenHelpRequests(pool);
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
   *       409:
   *         description: Request already claimed or not open.
   */
  teleopOnly.post('/teleoperator/help-requests/:id/accept', async (req, res) => {
    try {
      const teleoperatorId = req.teleopUser.id;
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

  router.use(teleopOnly);

  return router;
}

module.exports = createTeleopHelpRouter;
