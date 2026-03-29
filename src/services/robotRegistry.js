const { v4: uuid } = require('uuid');
const logger = require('../utils/logger');

class RobotRegistry {
  constructor({ healthMonitor }) {
    this.healthMonitor = healthMonitor;
    this.robots = new Map();
  }

  list() {
    return Array.from(this.robots.values());
  }

  getById(robotId) {
    return this.robots.get(robotId) || null;
  }

  get(robotId) {
    return this.getById(robotId);
  }

  async addRobot({
    name,
    host,
    port,
    requiresX402 = false,
    rosbridgeHost,
    rosbridgePort,
    teleopSecret,
  }) {
    const id = uuid();
    const robot = {
      id,
      name: name || `Robot-${id.slice(0, 6)}`,
      host,
      port,
      requiresX402,
      rosbridgeHost: rosbridgeHost != null && rosbridgeHost !== '' ? rosbridgeHost : host,
      rosbridgePort: rosbridgePort != null ? Number(rosbridgePort) : 9090,
      teleopSecret: teleopSecret != null && teleopSecret !== '' ? String(teleopSecret) : null,
      status: {
        state: 'unknown',
        message: 'Awaiting first health check',
        availableMethods: [],
      },
      lastHealthCheckAt: null,
      location: null,
    };

    this.robots.set(id, robot);
    logger.info('Robot registered', { id, host, port, requiresX402 });

    try {
      await this.refreshRobot(robot.id);
    } catch (error) {
      logger.warn('Initial health check failed', { id: robot.id, error: error.message });
    }

    return this.getById(id);
  }

  async refreshRobot(robotId) {
    const robot = this.getById(robotId);
    if (!robot) {
      throw new Error('Robot not found');
    }

    const status = await this.healthMonitor.probe(robot);
    this.updateStatus(robotId, status);
    return this.getById(robotId);
  }

  updateStatus(robotId, status) {
    const robot = this.getById(robotId);
    if (!robot) {
      throw new Error('Robot not found');
    }

    robot.status = {
      state: status.state,
      message: status.message || '',
      availableMethods: status.availableMethods || [],
      secure: status.secure ?? false,
    };
    robot.location = status.location || robot.location;
    robot.lastHealthCheckAt = new Date().toISOString();
    this.robots.set(robotId, robot);
    return robot;
  }

  removeRobot(robotId) {
    return this.robots.delete(robotId);
  }

  getRobotsByState(state) {
    return this.list().filter((robot) => robot.status.state === state);
  }

  updateRobot(robotId, updates) {
    const robot = this.getById(robotId);
    if (!robot) {
      throw new Error('Robot not found');
    }

    const next = { ...updates };
    if (next.teleopSecret === '' || next.teleopSecret === undefined) {
      delete next.teleopSecret;
    }
    if (next.rosbridgePort != null) {
      next.rosbridgePort = Number(next.rosbridgePort);
    }

    const merged = {
      ...robot,
      ...next,
      status: {
        ...robot.status,
        ...(next.status || {}),
      },
    };

    if (!merged.rosbridgeHost) {
      merged.rosbridgeHost = merged.host;
    }
    if (merged.rosbridgePort == null || Number.isNaN(merged.rosbridgePort)) {
      merged.rosbridgePort = 9090;
    }

    this.robots.set(robotId, merged);
    return merged;
  }
}

module.exports = RobotRegistry;

