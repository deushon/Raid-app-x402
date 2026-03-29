const logger = require('../utils/logger');

function createTeleopOperatorHub() {
  const clients = new Set();

  return {
    add(ws) {
      clients.add(ws);
    },
    remove(ws) {
      clients.delete(ws);
    },
    size() {
      return clients.size;
    },
    broadcast(event) {
      const payload = JSON.stringify(event);
      for (const ws of clients) {
        if (ws.readyState === 1) {
          try {
            ws.send(payload);
          } catch (error) {
            logger.warn('teleop hub send failed', { error: error.message });
          }
        }
      }
    },
  };
}

module.exports = { createTeleopOperatorHub };
