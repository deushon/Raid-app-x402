const { v4: uuid } = require('uuid');
const logger = require('../utils/logger');
const { rowToRobot } = require('./robotRepository');

class RobotRegistry {
  /**
   * @param {{ healthMonitor: object, robotRepository?: ReturnType<import('./robotRepository').createRobotRepository> | null }} deps
   */
  constructor({ healthMonitor, robotRepository = null }) {
    this.healthMonitor = healthMonitor;
    this.robotRepository = robotRepository || null;
    this.robots = new Map();
  }

  /**
   * Load robots from PostgreSQL when robotRepository is configured (call once at startup).
   */
  async loadFromPersistence() {
    if (!this.robotRepository) {
      return;
    }
    const rows = await this.robotRepository.listAll();
    this.robots.clear();
    for (const row of rows) {
      const robot = rowToRobot(row);
      this.robots.set(robot.id, robot);
    }
    logger.info('Robots loaded from database', { count: rows.length });
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
        secure: false,
      },
      lastHealthCheckAt: null,
      location: null,
    };

    if (this.robotRepository) {
      await this.robotRepository.insert(robot);
    }
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

  async removeRobot(robotId) {
    if (!this.getById(robotId)) {
      return false;
    }
    if (this.robotRepository) {
      await this.robotRepository.deleteById(robotId);
    }
    return this.robots.delete(robotId);
  }

  getRobotsByState(state) {
    return this.list().filter((robot) => robot.status.state === state);
  }

  async updateRobot(robotId, updates) {
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
    if (this.robotRepository) {
      await this.robotRepository.updateStatic(merged);
    }
    return merged;
  }
}

module.exports = RobotRegistry;
