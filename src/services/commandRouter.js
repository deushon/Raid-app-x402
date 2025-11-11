const axios = require('axios');
const logger = require('../utils/logger');

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const calculateDistance = (a, b) => {
  if (!a || !b) {
    return Number.POSITIVE_INFINITY;
  }
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return Math.sqrt(dx * dx + dy * dy);
};

const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const createCommandRouter = ({ config, registry, x402Service }) => {
  const confirmationConfig = config.x402?.confirmation || {};
  const confirmMaxAttempts = Number.isInteger(confirmationConfig.maxAttempts)
    ? Math.max(1, confirmationConfig.maxAttempts)
    : 5;
  const confirmDelayMs = Number.isFinite(confirmationConfig.delayMs)
    ? Math.max(200, confirmationConfig.delayMs)
    : 2000;

  const robotSupportsMoveDemo = (robot) => {
    const methods = robot.status?.availableMethods || [];
    return methods.some((method) => {
      if (!method) {
        return false;
      }
      if (typeof method === 'string') {
        return method.toLowerCase().includes('move_demo');
      }

      const path = method.path || '';
      const description = method.description || '';
      const callable = method.rosAction?.callable || '';

      return (
        path.toLowerCase().includes('move_demo')
        || description.toLowerCase().includes('move demo')
        || callable.toLowerCase().includes('move_demo')
      );
    });
  };

  const driveCommand = async ({ robot, endpoint, payload, headers = {} }) => {
    const baseUrl = `http://${robot.host}:${robot.port}`;
    const url = `${baseUrl}${endpoint}`;
    const requestOptions = {
      url,
      method: 'POST',
      data: payload,
      timeout: config.robots.commandTimeoutMs,
      headers,
    };

    logger.info('Dispatching command to robot', {
      robotId: robot.id,
      endpoint,
      payload,
      headers,
    });

    const executor = robot.requiresX402
      ? () => x402Service.sendSecuredRequest(requestOptions)
      : () => axios(requestOptions);

    try {
      const response = await executor();
      logger.info('Robot response received', {
        robotId: robot.id,
        endpoint,
        status: response.status,
        data: response.data,
      });
      return response;
    } catch (error) {
      if (error.response) {
        logger.warn('Robot responded with error status', {
          robotId: robot.id,
          endpoint,
          status: error.response.status,
          data: error.response.data,
        });
        return error.response;
      }
      logger.error('Robot command request failed', {
        robotId: robot.id,
        endpoint,
        error: error.message,
      });
      throw error;
    }
  };

  const selectRobotsForDance = (requestedCount) => {
    const readyRobots = registry.getRobotsByState('ready').filter(robotSupportsMoveDemo);
    if (readyRobots.length === 0) {
      throw createHttpError(409, 'No ready robots with move_demo capability available');
    }

    if (requestedCount === 'all') {
      return readyRobots;
    }

    const quantity = Number(requestedCount);
    if (![1, 2].includes(quantity)) {
      throw createHttpError(400, 'Dance quantity must be 1, 2, or "all"');
    }

    if (readyRobots.length < quantity) {
      throw createHttpError(
        409,
        `Not enough ready robots with move_demo capability (requested ${quantity}, available ${readyRobots.length})`,
      );
    }

    return readyRobots.slice(0, quantity);
  };

  const executeMoveDemo = async (robot) => {
    const endpoint = '/api/v1/robot/move_demo';
    const payload = {};

    const initialResponse = await driveCommand({
      robot,
      endpoint,
      payload,
    });

    if (initialResponse.status === 200) {
      return {
        status: 'success',
        stage: 'completed',
        response: initialResponse.data,
      };
    }

    if (!initialResponse) {
      return {
        status: 'failed',
        stage: 'initial',
        error: 'Robot did not respond to move demo command',
      };
    }

    if (initialResponse.status !== 402) {
      return {
        status: 'failed',
        stage: 'initial',
        error: initialResponse.data?.error || initialResponse.data?.message || 'Unexpected robot response',
        httpStatus: initialResponse.status,
        response: initialResponse.data,
      };
    }

    const invoice = initialResponse.data || {};

    const { reference, receiver, amount, asset } = invoice;
    if (!reference || !receiver || asset === undefined || amount === undefined) {
      return {
        status: 'failed',
        stage: 'payment_initiation',
        error: 'Missing payment fields in robot response',
        httpStatus: initialResponse.status,
        response: initialResponse.data,
      };
    }

    let settlement;
    try {
      settlement = await x402Service.settleInvoice(invoice);
      logger.info('Payment settlement result', settlement);
    } catch (error) {
      return {
        status: 'failed',
        stage: 'payment_settlement',
        error: error.response?.data?.error || error.message || 'Payment settlement failed',
        httpStatus: error.response?.status,
        response: error.response?.data,
        invoice,
      };
    }

    let attempt = 0;
    let finalResponse = null;

    while (attempt < confirmMaxAttempts) {
      attempt += 1;
      const paymentResponse = await driveCommand({
        robot,
        endpoint,
        payload,
        headers: {
          'X-X402-Reference': reference,
        },
      });

      finalResponse = paymentResponse;

      if (paymentResponse) {
        logger.info('Payment confirmation attempt result', {
          attempt,
          status: paymentResponse.status,
          data: paymentResponse.data,
        });
      }

      if (!paymentResponse || paymentResponse.status === 200) {
        break;
      }

      if (paymentResponse.status !== 402) {
        break;
      }

      if (attempt < confirmMaxAttempts) {
        await delay(confirmDelayMs);
      }
    }

    if (!finalResponse) {
      return {
        status: 'failed',
        stage: 'payment_confirmation',
        error: 'Robot did not respond to payment confirmation',
        invoice,
        payment: settlement,
        attempts: attempt,
      };
    }

    if (finalResponse.status === 200) {
      return {
        status: 'success',
        stage: 'payment_confirmed',
        response: finalResponse.data,
        payment: settlement,
        invoice,
        attempts: attempt,
      };
    }

    return {
      status: 'failed',
      stage: 'payment_confirmation',
      error: finalResponse.data?.error || finalResponse.data?.message || 'Robot rejected payment confirmation',
      httpStatus: finalResponse.status,
      response: finalResponse.data,
      invoice,
      payment: settlement,
      attempts: attempt,
    };
  };

  const dance = async ({ quantity, mode }) => {
    const selectionInput = quantity ?? mode;
    if (!selectionInput) {
      throw createHttpError(400, 'Dance quantity is required');
    }

    const selectedRobots = selectRobotsForDance(selectionInput);
    const responses = [];

    for (const robot of selectedRobots) {
      try {
        const result = await executeMoveDemo(robot);
        responses.push({
          robotId: robot.id,
          ...result,
        });
      } catch (error) {
        logger.error('Dance command failed for robot', { robotId: robot.id, error: error.message });
        responses.push({
          robotId: robot.id,
          status: 'failed',
          error: error.message,
          stage: error.stage || 'transport',
        });
      }
    }

    return responses;
  };

  const selectRobotByLocation = (location) => {
    const available = registry.list().filter((robot) => robot.status.state === 'ready');

    if (available.length === 0) {
      throw createHttpError(409, 'No robots ready for dispatch');
    }

    const [closest] = available
      .map((robot) => ({
        robot,
        distance: calculateDistance(robot.location, location),
      }))
      .sort((left, right) => left.distance - right.distance);

    if (!closest || !Number.isFinite(closest.distance)) {
      throw createHttpError(422, 'Unable to determine closest robot. Ensure robots report their location.');
    }

    return closest.robot;
  };

  const buyCola = async ({ location, quantity }) => {
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      throw createHttpError(400, 'Location with numeric lat and lng is required');
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw createHttpError(400, 'Quantity must be a positive integer');
    }

    const robot = selectRobotByLocation(location);
    try {
      const response = await driveCommand({
        robot,
        endpoint: '/commands/buy-cola',
        payload: { location, quantity },
      });

      return {
        robotId: robot.id,
        status: 'success',
        response: response.data,
      };
    } catch (error) {
      return {
        robotId: robot.id,
        status: 'failed',
        error: error.message,
      };
    }
  };

  return {
    dance,
    buyCola,
  };
};

module.exports = createCommandRouter;

