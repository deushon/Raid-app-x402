const logger = require('../utils/logger');

/**
 * AI Agent Service для выбора оптимальных исполнителей
 * Поддерживает интеграцию с N8N или использование встроенных стратегий
 */
class AIAgentService {
  constructor({ config = {} }) {
    this.config = config;
    this.n8nWebhookUrl = config.n8nWebhookUrl || process.env.N8N_WEBHOOK_URL || null;
    this.strategy = config.strategy || process.env.AI_AGENT_STRATEGY || 'smart';
  }

  /**
   * Выбирает оптимального робота для выполнения команды
   * @param {Object} options
   * @param {Array} options.robots - Доступные роботы
   * @param {String} options.command - Команда для выполнения
   * @param {Object} options.parameters - Параметры команды
   * @param {Object} options.context - Дополнительный контекст (location, priority, etc.)
   */
  async selectExecutor({ robots, command, parameters = {}, context = {} }) {
    if (!robots || robots.length === 0) {
      throw new Error('No robots available for selection');
    }

    // Если настроен N8N, используем его
    if (this.n8nWebhookUrl) {
      try {
        return await this.selectViaN8N({ robots, command, parameters, context });
      } catch (error) {
        logger.warn('N8N selection failed, falling back to local strategy', { error: error.message });
      }
    }

    // Используем встроенную стратегию
    return this.selectViaStrategy({ robots, command, parameters, context });
  }

  /**
   * Выбор через N8N webhook
   */
  async selectViaN8N({ robots, command, parameters, context }) {
    const axios = require('axios');
    
    const payload = {
      robots: robots.map(robot => ({
        id: robot.id,
        name: robot.name,
        status: robot.status,
        location: robot.location,
        availableMethods: robot.status?.availableMethods || [],
        pricing: this.extractPricing(robot, command),
      })),
      command,
      parameters,
      context,
    };

    const response = await axios.post(this.n8nWebhookUrl, payload, {
      timeout: 5000,
    });

    if (response.data && response.data.selectedRobotId) {
      const selected = robots.find(r => r.id === response.data.selectedRobotId);
      if (selected) {
        return {
          robot: selected,
          reason: response.data.reason || 'Selected by N8N AI agent',
          confidence: response.data.confidence || 0.8,
        };
      }
    }

    throw new Error('N8N did not return valid robot selection');
  }

  /**
   * Встроенная стратегия выбора
   */
  selectViaStrategy({ robots, command, parameters, context }) {
    switch (this.strategy) {
      case 'smart':
        return this.smartSelection({ robots, command, parameters, context });
      case 'lowest_price':
        return this.lowestPriceSelection({ robots, command });
      case 'closest':
        return this.closestSelection({ robots, context });
      case 'fastest':
        return this.fastestSelection({ robots });
      default:
        return this.smartSelection({ robots, command, parameters, context });
    }
  }

  /**
   * Умный выбор на основе множества факторов
   */
  smartSelection({ robots, command, parameters, context }) {
    const scored = robots.map(robot => {
      let score = 0;

      // Фактор 1: Цена (чем дешевле, тем лучше, но не критично)
      const pricing = this.extractPricing(robot, command);
      if (pricing) {
        score += (1 / (pricing.amount + 0.001)) * 0.3; // Нормализация
      }

      // Фактор 2: Близость (если указана локация)
      if (context.location && robot.location) {
        const distance = this.calculateDistance(context.location, robot.location);
        score += (1 / (distance + 1)) * 0.3;
      }

      // Фактор 3: Доступность методов
      const hasMethod = this.robotHasMethod(robot, command);
      if (hasMethod) {
        score += 0.2;
      }

      // Фактор 4: Статус (ready лучше чем busy)
      if (robot.status?.state === 'ready') {
        score += 0.2;
      }

      return { robot, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const selected = scored[0];

    return {
      robot: selected.robot,
      reason: `Smart selection based on price, location, and availability (score: ${selected.score.toFixed(2)})`,
      confidence: Math.min(selected.score / 1.0, 1.0),
    };
  }

  /**
   * Выбор самого дешевого робота
   */
  lowestPriceSelection({ robots, command }) {
    const withPricing = robots
      .map(robot => ({
        robot,
        price: this.extractPricing(robot, command)?.amount || Infinity,
      }))
      .filter(item => item.price !== Infinity)
      .sort((a, b) => a.price - b.price);

    if (withPricing.length === 0) {
      // Fallback на первый доступный
      return {
        robot: robots[0],
        reason: 'No pricing available, selected first available robot',
        confidence: 0.5,
      };
    }

    return {
      robot: withPricing[0].robot,
      reason: `Lowest price: ${withPricing[0].price} SOL`,
      confidence: 0.9,
    };
  }

  /**
   * Выбор ближайшего робота
   */
  closestSelection({ robots, context }) {
    if (!context.location) {
      return {
        robot: robots[0],
        reason: 'No location context, selected first available robot',
        confidence: 0.5,
      };
    }

    const withDistance = robots
      .filter(robot => robot.location)
      .map(robot => ({
        robot,
        distance: this.calculateDistance(context.location, robot.location),
      }))
      .sort((a, b) => a.distance - b.distance);

    if (withDistance.length === 0) {
      return {
        robot: robots[0],
        reason: 'No robots with location data, selected first available',
        confidence: 0.5,
      };
    }

    return {
      robot: withDistance[0].robot,
      reason: `Closest robot (distance: ${withDistance[0].distance.toFixed(4)})`,
      confidence: 0.9,
    };
  }

  /**
   * Выбор самого быстрого робота (по последнему времени ответа)
   */
  fastestSelection({ robots }) {
    // Простая эвристика: выбираем робота с самым свежим health check
    const sorted = robots
      .map(robot => ({
        robot,
        lastCheck: robot.lastHealthCheckAt ? new Date(robot.lastHealthCheckAt).getTime() : 0,
      }))
      .sort((a, b) => b.lastCheck - a.lastCheck);

    return {
      robot: sorted[0].robot,
      reason: 'Selected robot with most recent health check',
      confidence: 0.7,
    };
  }

  /**
   * Извлекает цену для команды из робота
   */
  extractPricing(robot, command) {
    const methods = robot.status?.availableMethods || [];
    const method = methods.find(m => {
      if (typeof m === 'string') {
        return m.toLowerCase().includes(command.toLowerCase());
      }
      const path = m.path || '';
      return path.toLowerCase().includes(command.toLowerCase());
    });

    if (method && typeof method !== 'string' && method.pricing) {
      return method.pricing;
    }

    return null;
  }

  /**
   * Проверяет, есть ли у робота нужный метод
   */
  robotHasMethod(robot, command) {
    const methods = robot.status?.availableMethods || [];
    return methods.some(m => {
      if (typeof m === 'string') {
        return m.toLowerCase().includes(command.toLowerCase());
      }
      const path = m.path || '';
      const description = m.description || '';
      return path.toLowerCase().includes(command.toLowerCase())
        || description.toLowerCase().includes(command.toLowerCase());
    });
  }

  /**
   * Вычисляет расстояние между двумя точками
   */
  calculateDistance(a, b) {
    if (!a || !b || typeof a.lat !== 'number' || typeof b.lat !== 'number') {
      return Infinity;
    }
    const dx = a.lat - b.lat;
    const dy = a.lng - b.lng;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

module.exports = AIAgentService;
