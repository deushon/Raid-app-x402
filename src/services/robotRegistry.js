const { v4: uuid } = require('uuid');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { rowToRobot, toPublicRobot } = require('./robotRepository');

class RobotRegistry {
  /**
   * @param {{ healthMonitor: object, robotRepository?: ReturnType<import('./robotRepository').createRobotRepository> | null }} deps
   */
  constructor({ healthMonitor, robotRepository = null }) {
    this.healthMonitor = healthMonitor;
    this.robotRepository = robotRepository || null;
    this.robots = new Map();
    /** @type {Map<string, string>} enrollmentKey -> robot id (memory-only registry) */
    this.enrollmentKeyToId = new Map();
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
    this.enrollmentKeyToId.clear();
    for (const row of rows) {
      const robot = rowToRobot(row);
      this.robots.set(robot.id, robot);
      if (robot.enrollmentKey) {
        this.enrollmentKeyToId.set(robot.enrollmentKey, robot.id);
      }
    }
    logger.info('Robots loaded from database', { count: rows.length });
  }

  list() {
    return Array.from(this.robots.values());
  }

  /** @returns {object[]} robots without teleopSecret */
  listPublic() {
    return this.list().map((r) => toPublicRobot(r));
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
    enrollmentKey,
    operatorRegistryUrl,
  }) {
    const id = uuid();
    const ek =
      enrollmentKey != null && String(enrollmentKey).trim() !== ''
        ? String(enrollmentKey).trim()
        : null;
    const oru =
      operatorRegistryUrl != null && String(operatorRegistryUrl).trim() !== ''
        ? String(operatorRegistryUrl).trim()
        : null;
    const robot = {
      id,
      name: name || `Robot-${id.slice(0, 6)}`,
      host,
      port,
      requiresX402,
      rosbridgeHost: rosbridgeHost != null && rosbridgeHost !== '' ? rosbridgeHost : host,
      rosbridgePort: rosbridgePort != null ? Number(rosbridgePort) : 9090,
      teleopSecret: teleopSecret != null && teleopSecret !== '' ? String(teleopSecret) : null,
      enrollmentKey: ek,
      operatorRegistryUrl: oru,
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
    if (ek) {
      this.enrollmentKeyToId.set(ek, id);
    }
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
    const prev = this.getById(robotId);
    if (!prev) {
      return false;
    }
    if (prev.enrollmentKey) {
      this.enrollmentKeyToId.delete(prev.enrollmentKey);
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
    if (next.enrollmentKey === '') {
      next.enrollmentKey = null;
    }
    if (next.operatorRegistryUrl === '') {
      next.operatorRegistryUrl = null;
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

    if (robot.enrollmentKey && robot.enrollmentKey !== merged.enrollmentKey) {
      this.enrollmentKeyToId.delete(robot.enrollmentKey);
    }
    if (merged.enrollmentKey) {
      this.enrollmentKeyToId.set(merged.enrollmentKey, robotId);
    }

    this.robots.set(robotId, merged);
    if (this.robotRepository) {
      await this.robotRepository.updateStatic(merged);
    }
    return merged;
  }

  /**
   * Idempotent fleet enrollment: upsert by stable enrollmentKey.
   * @param {object} p
   */
  async enrollOrUpdateRobot(p) {
    const key = String(p.enrollmentKey || '').trim();
    if (!key) {
      throw new Error('enrollmentKey is required');
    }
    let existingId = this.enrollmentKeyToId.get(key) || null;
    if (!existingId && this.robotRepository) {
      const row = await this.robotRepository.findByEnrollmentKey(key);
      if (row) {
        existingId = row.id;
        if (!this.getById(existingId)) {
          const sync = rowToRobot(row);
          this.robots.set(existingId, sync);
          this.enrollmentKeyToId.set(key, existingId);
        }
      }
    }
    if (existingId) {
      const cur = this.getById(existingId);
      if (!cur) {
        this.enrollmentKeyToId.delete(key);
      } else {
        const nextSecret =
          p.teleopSecret != null && String(p.teleopSecret).trim() !== ''
            ? String(p.teleopSecret).trim()
            : cur.teleopSecret;
        return this.updateRobot(existingId, {
          name: p.name != null && String(p.name).trim() !== '' ? String(p.name).trim() : cur.name,
          host: p.host,
          port: p.port,
          requiresX402: p.requiresX402 ?? cur.requiresX402,
          rosbridgeHost:
            p.rosbridgeHost != null && String(p.rosbridgeHost).trim() !== ''
              ? String(p.rosbridgeHost).trim()
              : p.host,
          rosbridgePort: p.rosbridgePort != null ? Number(p.rosbridgePort) : cur.rosbridgePort,
          teleopSecret: nextSecret,
          enrollmentKey: key,
          operatorRegistryUrl:
            p.operatorRegistryUrl !== undefined ? p.operatorRegistryUrl : cur.operatorRegistryUrl,
        });
      }
    }
    const autoSecret =
      p.teleopSecret != null && String(p.teleopSecret).trim() !== ''
        ? String(p.teleopSecret).trim()
        : crypto.randomBytes(24).toString('base64url');
    const oru =
      p.operatorRegistryUrl != null && String(p.operatorRegistryUrl).trim() !== ''
        ? String(p.operatorRegistryUrl).trim()
        : null;
    return this.addRobot({
      name: p.name,
      host: p.host,
      port: p.port,
      requiresX402: p.requiresX402 ?? false,
      rosbridgeHost: p.rosbridgeHost,
      rosbridgePort: p.rosbridgePort,
      teleopSecret: autoSecret,
      enrollmentKey: key,
      operatorRegistryUrl: oru,
    });
  }
}

module.exports = RobotRegistry;
