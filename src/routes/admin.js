const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

const CONFIG_FILE = path.join(process.cwd(), 'config', 'ai-agent.json');

const createAdminRouter = () => {
  const router = express.Router();

  /**
   * Получить конфигурацию AI агента
   */
  router.get('/ai-agent', async (req, res) => {
    try {
      const config = await fs.readFile(CONFIG_FILE, 'utf-8').catch(() => '{}');
      const parsed = JSON.parse(config);
      res.json(parsed);
    } catch (error) {
      logger.error('Failed to read AI agent config', { error: error.message });
      res.json({});
    }
  });

  /**
   * Сохранить конфигурацию AI агента
   */
  router.post('/ai-agent', async (req, res) => {
    try {
      const config = req.body;
      
      // Валидация
      if (config.strategy && !['smart', 'lowest_price', 'closest', 'fastest'].includes(config.strategy)) {
        return res.status(400).json({ error: 'Invalid strategy' });
      }

      // Сохраняем в файл
      await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
      await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');

      // Обновляем переменные окружения (для текущей сессии)
      if (config.strategy) {
        process.env.AI_AGENT_STRATEGY = config.strategy;
      }
      if (config.n8nWebhookUrl) {
        process.env.N8N_WEBHOOK_URL = config.n8nWebhookUrl;
      }

      logger.info('AI Agent configuration saved', { strategy: config.strategy });
      res.json({ success: true, config });
    } catch (error) {
      logger.error('Failed to save AI agent config', { error: error.message });
      res.status(500).json({ error: 'Failed to save configuration' });
    }
  });

  return router;
};

module.exports = createAdminRouter;
