const express = require('express');

const createCommandsRouter = ({ commandRouter }) => {
  const router = express.Router();

  /**
   * @openapi
   * /api/commands/dance:
   *   post:
   *     tags:
   *       - Commands
   *     summary: Dispatch dance routine
   *     description: Selects one or more ready robots and triggers the dance command.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DanceCommandRequest'
   *     responses:
   *       200:
   *         description: Command dispatch results.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 results:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       robotId:
   *                         type: string
   *                       status:
   *                         type: string
   *                         enum: [success, failed]
   *                       response:
   *                         type: object
   *                         nullable: true
   *                       error:
   *                         type: string
   *                         nullable: true
   *       400:
   *         description: Invalid mode provided.
   *       404:
   *         description: No robots ready to execute the command.
   */
  router.post('/dance', async (req, res, next) => {
    try {
      const { mode } = req.body;
      if (!mode) {
        return res.status(400).json({ error: 'Mode is required' });
      }
      const results = await commandRouter.dance({ mode });
      return res.json({ results });
    } catch (error) {
      if (error.message.includes('No robots')) {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes('Dance mode')) {
        return res.status(400).json({ error: error.message });
      }
      return next(error);
    }
  });

  /**
   * @openapi
   * /api/commands/buy-cola:
   *   post:
   *     tags:
   *       - Commands
   *     summary: Dispatch buy cola task
   *     description: Finds the closest ready robot to the requested coordinates and sends the buy-cola command.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/BuyColaCommandRequest'
   *     responses:
   *       200:
   *         description: Command dispatch outcome.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 robotId:
   *                   type: string
   *                 status:
   *                   type: string
   *                   enum: [success, failed]
   *                 response:
   *                   type: object
   *                   nullable: true
   *                 error:
   *                   type: string
   *                   nullable: true
   *       400:
   *         description: Invalid location or quantity.
   *       404:
   *         description: No robots available to handle the task.
   */
  router.post('/buy-cola', async (req, res, next) => {
    try {
      const { location, quantity } = req.body;
      const result = await commandRouter.buyCola({ location, quantity });
      return res.json(result);
    } catch (error) {
      if (error.message.includes('Location') || error.message.includes('Quantity')) {
        return res.status(400).json({ error: error.message });
      }
      if (error.message.includes('No robots ready')) {
        return res.status(404).json({ error: error.message });
      }
      return next(error);
    }
  });

  return router;
};

module.exports = createCommandsRouter;

