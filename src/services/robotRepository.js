/**
 * @param {import('pg').Pool} pool
 */
function createRobotRepository(pool) {
  return {
    /**
     * @returns {Promise<Array<import('pg').QueryResultRow>>}
     */
    async listAll() {
      const r = await pool.query(
        `SELECT id, name, host, port, requires_x402, rosbridge_host, rosbridge_port, teleop_secret
         FROM robots ORDER BY created_at ASC`,
      );
      return r.rows;
    },

    /**
     * @param {object} robot
     */
    async insert(robot) {
      await pool.query(
        `INSERT INTO robots (id, name, host, port, requires_x402, rosbridge_host, rosbridge_port, teleop_secret)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          robot.id,
          robot.name,
          robot.host,
          robot.port,
          Boolean(robot.requiresX402),
          robot.rosbridgeHost,
          robot.rosbridgePort,
          robot.teleopSecret,
        ],
      );
    },

    /**
     * @param {object} robot merged static fields
     */
    async updateStatic(robot) {
      await pool.query(
        `UPDATE robots SET
           name = $2,
           host = $3,
           port = $4,
           requires_x402 = $5,
           rosbridge_host = $6,
           rosbridge_port = $7,
           teleop_secret = $8,
           updated_at = NOW()
         WHERE id = $1`,
        [
          robot.id,
          robot.name,
          robot.host,
          robot.port,
          Boolean(robot.requiresX402),
          robot.rosbridgeHost,
          robot.rosbridgePort,
          robot.teleopSecret,
        ],
      );
    },

    /**
     * @param {string} robotId
     */
    async deleteById(robotId) {
      const r = await pool.query('DELETE FROM robots WHERE id = $1', [robotId]);
      return r.rowCount > 0;
    },
  };
}

/**
 * @param {import('pg').QueryResultRow} row
 */
function rowToRobot(row) {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    requiresX402: row.requires_x402,
    rosbridgeHost: row.rosbridge_host,
    rosbridgePort: row.rosbridge_port,
    teleopSecret: row.teleop_secret != null ? String(row.teleop_secret) : null,
    status: {
      state: 'unknown',
      message: 'Awaiting health check',
      availableMethods: [],
      secure: false,
    },
    lastHealthCheckAt: null,
    location: null,
  };
}

module.exports = { createRobotRepository, rowToRobot };
