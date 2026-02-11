const express = require('express');
const axios = require('axios');
const logger = require('../utils/logger');
const ClientPaymentService = require('../services/clientPaymentService');
const AIAgentService = require('../services/aiAgentService');

const createClientRouter = ({
  registry,
  commandRouter,
  x402Service,
  config,
  getSolanaRpcUrl,
  getSettings,
  saveSettings,
}) => {
  const clientPaymentService = new ClientPaymentService({
    getRpcUrl: getSolanaRpcUrl || (() => config?.x402?.solana?.rpcUrl || process.env.X402_SOLANA_RPC_URL),
    commitment: config?.x402?.solana?.commitment || 'confirmed',
  });

  const aiAgentService = new AIAgentService({
    config: config?.aiAgent || {},
  });
  const router = express.Router();

  /**
   * Получить настройки (RPC URL для клиента, провайдер, без сырого API ключа)
   */
  router.get('/settings', (req, res) => {
    try {
      const settings = getSettings ? getSettings() : {};
      res.json(settings);
    } catch (error) {
      logger.error('Failed to get client settings', { error: error.message });
      res.status(500).json({ error: 'Failed to get settings' });
    }
  });

  /**
   * Сохранить настройки RPC (провайдер, Helius API ключ, кастомный URL)
   */
  router.post('/settings', (req, res) => {
    try {
      const { rpcProvider, heliusApiKey, customRpcUrl } = req.body || {};
      const updated = saveSettings ? saveSettings({
        rpcProvider,
        heliusApiKey,
        customRpcUrl,
      }) : {};
      res.json(updated);
    } catch (error) {
      logger.error('Failed to save client settings', { error: error.message });
      res.status(500).json({ error: 'Failed to save settings' });
    }
  });

  /**
   * Получить список доступных роботов (для Direct режима)
   */
  router.get('/robots', (req, res) => {
    try {
      const robots = registry.list()
        .filter((robot) => robot.status.state === 'ready')
        .map((robot) => ({
          id: robot.id,
          name: robot.name || `Robot ${robot.id}`,
          host: robot.host,
          port: robot.port,
          status: robot.status.state,
          location: robot.location,
          availableMethods: robot.status.availableMethods || [],
          requiresX402: robot.requiresX402 || false,
        }));

      res.json({ robots });
    } catch (error) {
      logger.error('Failed to list robots for client', { error: error.message });
      res.status(500).json({ error: 'Failed to retrieve robots' });
    }
  });

  /**
   * Получить список доступных команд (для RAID режима)
   */
  router.get('/commands', (req, res) => {
    try {
      const robots = registry.list().filter((robot) => robot.status.state === 'ready');
      const commandsMap = new Map();

      robots.forEach((robot) => {
        const methods = robot.status?.availableMethods || [];
        methods.forEach((method) => {
          if (typeof method === 'string') {
            if (!commandsMap.has(method)) {
              commandsMap.set(method, {
                name: method,
                description: `Command: ${method}`,
                availableRobots: [],
              });
            }
            commandsMap.get(method).availableRobots.push(robot.id);
          } else {
            const methodName = method.path || method.description || 'unknown';
            if (!commandsMap.has(methodName)) {
              commandsMap.set(methodName, {
                name: methodName,
                description: method.description || `Command: ${methodName}`,
                httpMethod: method.httpMethod,
                parameters: method.parameters,
                pricing: method.pricing,
                availableRobots: [],
              });
            }
            commandsMap.get(methodName).availableRobots.push(robot.id);
          }
        });
      });

      const commands = Array.from(commandsMap.values());
      res.json({ commands });
    } catch (error) {
      logger.error('Failed to list commands for client', { error: error.message });
      res.status(500).json({ error: 'Failed to retrieve commands' });
    }
  });

  /**
   * Получить предварительную стоимость действия
   */
  router.post('/estimate', async (req, res) => {
    try {
      const { mode, robotId, command, parameters } = req.body;

      if (!mode || (mode !== 'direct' && mode !== 'raid')) {
        return res.status(400).json({ error: 'Invalid mode. Must be "direct" or "raid"' });
      }

      let estimatedPrice = null;
      let selectedRobot = null;

      if (mode === 'direct') {
        if (!robotId || !command) {
          return res.status(400).json({ error: 'robotId and command are required for direct mode' });
        }

        const robot = registry.getById(robotId);
        if (!robot) {
          return res.status(404).json({ error: 'Robot not found' });
        }

        if (robot.status.state !== 'ready') {
          return res.status(409).json({ error: 'Robot is not ready' });
        }

        selectedRobot = {
          id: robot.id,
          name: robot.name || `Robot ${robot.id}`,
        };

        // Найти метод и его цену
        const methods = robot.status?.availableMethods || [];
        const method = methods.find((m) => {
          if (typeof m === 'string') {
            return m.toLowerCase().includes(command.toLowerCase());
          }
          const path = m.path || '';
          return path.toLowerCase().includes(command.toLowerCase());
        });

        if (method && typeof method !== 'string' && method.pricing) {
          estimatedPrice = method.pricing.amount || null;
        }
      } else {
        // RAID mode - используем AI агент для выбора
        if (!command) {
          return res.status(400).json({ error: 'command is required for raid mode' });
        }

        const robots = registry.list().filter((robot) => robot.status.state === 'ready');
        const robotsWithCommand = robots.filter(robot => {
          const methods = robot.status?.availableMethods || [];
          return methods.some(m => {
            if (typeof m === 'string') {
              return m.toLowerCase().includes(command.toLowerCase());
            }
            const path = m.path || '';
            return path.toLowerCase().includes(command.toLowerCase());
          });
        });

        if (robotsWithCommand.length === 0) {
          return res.status(404).json({ error: 'No available robot found for this command' });
        }

        // Используем AI агент для выбора
        try {
          const selection = await aiAgentService.selectExecutor({
            robots: robotsWithCommand,
            command,
            parameters,
            context: {
              location: parameters?.location,
            },
          });

          selectedRobot = {
            id: selection.robot.id,
            name: selection.robot.name || `Robot ${selection.robot.id}`,
          };

          const method = selection.robot.status?.availableMethods?.find(m => {
            if (typeof m === 'string') {
              return m.toLowerCase().includes(command.toLowerCase());
            }
            const path = m.path || '';
            return path.toLowerCase().includes(command.toLowerCase());
          });

          if (method && typeof method !== 'string' && method.pricing) {
            estimatedPrice = method.pricing.amount || null;
          }
        } catch (error) {
          logger.warn('AI agent selection failed in estimate, using first available', { error: error.message });
          // Fallback на первый доступный
          const robot = robotsWithCommand[0];
          selectedRobot = {
            id: robot.id,
            name: robot.name || `Robot ${robot.id}`,
          };
          const method = robot.status?.availableMethods?.find(m => {
            if (typeof m === 'string') {
              return m.toLowerCase().includes(command.toLowerCase());
            }
            const path = m.path || '';
            return path.toLowerCase().includes(command.toLowerCase());
          });
          if (method && typeof method !== 'string' && method.pricing) {
            estimatedPrice = method.pricing.amount || null;
          }
        }
      }

      res.json({
        estimatedPrice,
        robot: selectedRobot,
        command,
        mode,
      });
    } catch (error) {
      logger.error('Failed to estimate price', { error: error.message });
      res.status(500).json({ error: 'Failed to estimate price' });
    }
  });

  /**
   * Выполнить действие с клиентской оплатой
   */
  router.post('/execute', async (req, res) => {
    let executionResult = null;
    let refundRequired = false;

    try {
      const {
        mode,
        robotId,
        command,
        parameters = {},
        paymentSignature,
        paymentTransaction,
      } = req.body;

      if (!mode || (mode !== 'direct' && mode !== 'raid')) {
        return res.status(400).json({ error: 'Invalid mode' });
      }

      if (!paymentSignature || !paymentTransaction) {
        return res.status(400).json({ error: 'Payment signature and transaction are required' });
      }

      // Проверяем платеж
      if (!clientPaymentService.isReady()) {
        logger.warn('Client payment service not ready, skipping verification');
      } else {
        const verification = await clientPaymentService.verifyTransaction(
          paymentSignature,
          paymentTransaction.receiver,
          paymentTransaction.amount,
        );

        if (!verification.valid) {
          return res.status(400).json({
            error: 'Payment verification failed',
            details: verification.error,
          });
        }
      }

      // Выбираем робота
      let robot;
      if (mode === 'direct') {
        if (!robotId) {
          return res.status(400).json({ error: 'robotId is required for direct mode' });
        }
        robot = registry.getById(robotId);
        if (!robot) {
          return res.status(404).json({ error: 'Robot not found' });
        }
      } else {
        // RAID mode - используем AI агент для выбора
        const robots = registry.list().filter(r => r.status.state === 'ready');
        const robotsWithCommand = robots.filter(r => {
          const methods = r.status?.availableMethods || [];
          return methods.some(m => {
            if (typeof m === 'string') {
              return m.toLowerCase().includes(command.toLowerCase());
            }
            const path = m.path || '';
            return path.toLowerCase().includes(command.toLowerCase());
          });
        });

        if (robotsWithCommand.length === 0) {
          return res.status(404).json({ error: 'No robots available for this command' });
        }

        // Используем AI агент для выбора оптимального робота
        try {
          const selection = await aiAgentService.selectExecutor({
            robots: robotsWithCommand,
            command,
            parameters,
            context: {
              location: parameters.location,
              priority: 'normal',
            },
          });
          robot = selection.robot;
          logger.info('AI agent selected robot', {
            robotId: robot.id,
            reason: selection.reason,
            confidence: selection.confidence,
          });
        } catch (error) {
          logger.warn('AI agent selection failed, using first available', { error: error.message });
          robot = robotsWithCommand[0];
        }
      }

      if (robot.status.state !== 'ready') {
        refundRequired = true;
        return res.status(409).json({
          error: 'Robot is not ready',
          refundRequired: true,
        });
      }

      // Находим метод
      const methods = robot.status?.availableMethods || [];
      const method = methods.find(m => {
        if (typeof m === 'string') {
          return m.toLowerCase().includes(command.toLowerCase());
        }
        const path = m.path || '';
        return path.toLowerCase().includes(command.toLowerCase());
      });

      if (!method) {
        refundRequired = true;
        return res.status(404).json({
          error: 'Command not found on selected robot',
          refundRequired: true,
        });
      }

      // Определяем endpoint
      const endpoint = typeof method === 'object' && method.path
        ? method.path
        : `/commands/${command}`;

      // Выполняем команду
      const baseUrl = `http://${robot.host}:${robot.port}`;
      const url = `${baseUrl}${endpoint}`;

      let response;
      try {
        // Повторный POST на робота после оплаты: всегда шлём reference, если он есть (сценарий 402 → pay → retry)
        const headers = {};
        if (paymentTransaction.reference) {
          headers['X-X402-Reference'] = paymentTransaction.reference;
        }

        response = await axios.post(url, parameters, {
          headers,
          timeout: config?.robots?.commandTimeoutMs || 8000,
        });

        executionResult = {
          status: 'success',
          robotId: robot.id,
          robotName: robot.name,
          command,
          response: response.data,
          payment: {
            signature: paymentSignature,
            verified: true,
          },
        };
      } catch (error) {
        if (error.response) {
          // Робот ответил, но с ошибкой
          executionResult = {
            status: 'failed',
            robotId: robot.id,
            robotName: robot.name,
            command,
            error: error.response.data?.error || error.response.data?.message || 'Robot returned error',
            httpStatus: error.response.status,
            payment: {
              signature: paymentSignature,
              verified: true,
            },
          };
          refundRequired = true;
        } else {
          // Ошибка сети или таймаут
          throw error;
        }
      }

      res.json(executionResult);
    } catch (error) {
      logger.error('Failed to execute command', { error: error.message, stack: error.stack });
      refundRequired = true;
      
      res.status(500).json({
        error: 'Failed to execute command',
        message: error.message,
        refundRequired: true,
      });
    } finally {
      // Если требуется возврат, инициируем его
      if (refundRequired && req.body.paymentTransaction) {
        try {
          await clientPaymentService.initiateRefund(
            req.body.paymentTransaction.sender || 'unknown',
            req.body.paymentTransaction.amount,
            executionResult?.error || 'Command execution failed',
          );
          logger.info('Refund initiated', {
            amount: req.body.paymentTransaction.amount,
            reason: executionResult?.error || 'Command execution failed',
          });
        } catch (refundError) {
          logger.error('Failed to initiate refund', { error: refundError.message });
        }
      }
    }
  });

  return router;
};

module.exports = createClientRouter;
