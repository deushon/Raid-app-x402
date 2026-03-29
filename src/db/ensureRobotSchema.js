/**
 * Idempotent DDL for persisted robot registry (PostgreSQL).
 * @param {import('pg').Pool} pool
 */
async function ensureRobotSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS robots (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      requires_x402 BOOLEAN NOT NULL DEFAULT false,
      rosbridge_host TEXT NOT NULL,
      rosbridge_port INTEGER NOT NULL DEFAULT 9090,
      teleop_secret TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

module.exports = { ensureRobotSchema };
