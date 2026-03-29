const express = require('express');

function sanitizeRobot(robot) {
  if (!robot) {
    return robot;
  }
  const { teleopSecret, ...rest } = robot;
  return rest;
}

const createRobotsRouter = ({ registry }) => {
  const router = express.Router();

  /**
   * @openapi
   * /api/robots:
   *   get:
   *     tags:
   *       - Robots
   *     summary: List registered robots
   *     responses:
   *       200:
   *         description: Current robot registry.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 robots:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Robot'
   */
  router.get('/', (req, res) => {
    res.json({ robots: registry.list().map(sanitizeRobot) });
  });

  /**
   * @openapi
   * /api/robots:
   *   post:
   *     tags:
   *       - Robots
   *     summary: Register a new robot
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/RegisterRobotRequest'
   *     responses:
   *       201:
   *         description: Robot added and health check scheduled.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Robot'
   *       400:
   *         description: Missing host or port.
   */
  router.post('/', async (req, res, next) => {
    try {
      const {
        name,
        host,
        port,
        requiresX402,
        rosbridgeHost,
        rosbridgePort,
        teleopSecret,
      } = req.body;
      if (!host || !port) {
        return res.status(400).json({ error: 'Host and port are required' });
      }
      const robot = await registry.addRobot({
        name,
        host,
        port,
        requiresX402,
        rosbridgeHost,
        rosbridgePort,
        teleopSecret,
      });
      return res.status(201).json(sanitizeRobot(robot));
    } catch (error) {
      return next(error);
    }
  });

  /**
   * @openapi
   * /api/robots/{robotId}:
   *   put:
   *     tags:
   *       - Robots
   *     summary: Update robot metadata
   *     parameters:
   *       - in: path
   *         name: robotId
   *         schema:
   *           type: string
   *         required: true
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             additionalProperties: true
   *     responses:
   *       200:
   *         description: Updated robot.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Robot'
   *       404:
   *         description: Robot not found.
   */
  router.put('/:robotId', (req, res, next) => {
    try {
      const { robotId } = req.params;
      const updates = req.body;
      const robot = registry.updateRobot(robotId, updates);
      return res.json(sanitizeRobot(robot));
    } catch (error) {
      return next(error);
    }
  });

  /**
   * @openapi
   * /api/robots/{robotId}:
   *   delete:
   *     tags:
   *       - Robots
   *     summary: Remove robot from registry
   *     parameters:
   *       - in: path
   *         name: robotId
   *         schema:
   *           type: string
   *         required: true
   *     responses:
   *       204:
   *         description: Robot removed.
   *       404:
   *         description: Robot not found.
   */
  router.delete('/:robotId', (req, res) => {
    const { robotId } = req.params;
    const result = registry.removeRobot(robotId);
    if (!result) {
      return res.status(404).json({ error: 'Robot not found' });
    }
    return res.status(204).send();
  });

  /**
   * @openapi
   * /api/robots/{robotId}/refresh:
   *   post:
   *     tags:
   *       - Robots
   *     summary: Trigger a robot health check
   *     parameters:
   *       - in: path
   *         name: robotId
   *         schema:
   *           type: string
   *         required: true
   *     responses:
   *       200:
   *         description: Updated robot snapshot.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Robot'
   *       404:
   *         description: Robot not found.
   */
  router.post('/:robotId/refresh', async (req, res, next) => {
    try {
      const { robotId } = req.params;
      const robot = await registry.refreshRobot(robotId);
      return res.json(sanitizeRobot(robot));
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

module.exports = createRobotsRouter;

