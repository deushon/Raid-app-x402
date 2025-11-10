const axios = require('axios');
const logger = require('../utils/logger');

const calculateDistance = (a, b) => {
  if (!a || !b) {
    return Number.POSITIVE_INFINITY;
  }
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return Math.sqrt(dx * dx + dy * dy);
};

const createCommandRouter = ({ config, registry, x402Service }) => {
  const driveCommand = async ({ robot, endpoint, payload }) => {
    const baseUrl = `http://${robot.host}:${robot.port}`;
    const url = `${baseUrl}${endpoint}`;
    const requestOptions = {
      url,
      method: 'POST',
      data: payload,
      timeout: config.robots.commandTimeoutMs,
    };

    logger.info('Dispatching command to robot', {
      robotId: robot.id,
      endpoint,
    });

    if (robot.requiresX402) {
      return x402Service.sendSecuredRequest(requestOptions);
    }

    return axios(requestOptions);
  };

  const selectRobotsForDance = (mode) => {
    const readyRobots = registry.getRobotsByState('ready');
    if (readyRobots.length === 0) {
      throw new Error('No robots are ready to perform the dance command');
    }

    if (mode === 'all') {
      return readyRobots;
    }

    const quantity = Number(mode);
    if (![1, 2].includes(quantity)) {
      throw new Error('Dance mode must be 1, 2, or "all"');
    }

    return readyRobots.slice(0, quantity);
  };

  const dance = async ({ mode }) => {
    const selectedRobots = selectRobotsForDance(mode);
    const responses = [];

    for (const robot of selectedRobots) {
      try {
        const response = await driveCommand({
          robot,
          endpoint: '/commands/dance',
          payload: { mode },
        });
        responses.push({
          robotId: robot.id,
          status: 'success',
          response: response.data,
        });
      } catch (error) {
        responses.push({
          robotId: robot.id,
          status: 'failed',
          error: error.message,
        });
      }
    }

    return responses;
  };

  const selectRobotByLocation = (location) => {
    const available = registry.list().filter((robot) => robot.status.state === 'ready');

    if (available.length === 0) {
      throw new Error('No robots ready for dispatch');
    }

    const [closest] = available
      .map((robot) => ({
        robot,
        distance: calculateDistance(robot.location, location),
      }))
      .sort((left, right) => left.distance - right.distance);

    if (!closest || !Number.isFinite(closest.distance)) {
      throw new Error('Unable to determine closest robot. Ensure robots report their location.');
    }

    return closest.robot;
  };

  const buyCola = async ({ location, quantity }) => {
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      throw new Error('Location with numeric lat and lng is required');
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error('Quantity must be a positive integer');
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

