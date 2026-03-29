const { WebSocketServer, WebSocket } = require('ws');
const logger = require('../utils/logger');
const { verifyTeleopToken } = require('../middleware/teleopSession');
const {
  getActiveSessionForOperator,
  endTeleopSession,
} = require('../services/teleopHelpRepository');

/**
 * @param {import('http').Server} httpServer
 * @param {{ config: object, pool: import('pg').Pool, registry: object, teleopHub: object }} deps
 */
function attachTeleopWebSockets(httpServer, deps) {
  const { config, pool, registry, teleopHub } = deps;
  const teleopCfg = config.teleop;

  if (!teleopCfg?.enabled) {
    logger.info('Teleop WebSocket server disabled (TELEOP_WS_ENABLED=false)');
    return;
  }

  const wss = new WebSocketServer({ noServer: true });
  const reservedProxySessions = new Set();

  httpServer.on('upgrade', (request, socket, head) => {
    const host = request.headers.host || 'localhost';
    let url;
    try {
      url = new URL(request.url, `http://${host}`);
    } catch {
      socket.destroy();
      return;
    }

    const { pathname, searchParams } = url;
    const token = searchParams.get('token');

    if (pathname === '/ws/teleoperator') {
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      const user = verifyTeleopToken(token, config.teleoperator);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.teleopUser = user;
        teleopHub.add(ws);
        ws.on('close', () => teleopHub.remove(ws));
        ws.on('error', () => teleopHub.remove(ws));
      });
      return;
    }

    const m = pathname.match(/^\/ws\/teleop\/session\/([^/]+)$/);
    if (m) {
      const sessionId = m[1];
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      const user = verifyTeleopToken(token, config.teleoperator);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleProxySession(ws, {
          sessionId,
          user,
          pool,
          registry,
          teleopCfg,
          reservedProxySessions,
        });
      });
      return;
    }

    socket.destroy();
  });

  logger.info('Teleop WebSocket upgrade handler attached', {
    paths: ['/ws/teleoperator', '/ws/teleop/session/:sessionId'],
  });
}

function handleProxySession(ws, ctx) {
  const {
    sessionId, user, pool, registry, teleopCfg, reservedProxySessions,
  } = ctx;

  let cleaned = false;
  let robotWs = null;

  const cleanupOnce = async () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    reservedProxySessions.delete(sessionId);
    try {
      if (robotWs && robotWs.readyState === WebSocket.OPEN) {
        robotWs.close();
      } else if (robotWs) {
        robotWs.close();
      }
    } catch {
      /* ignore */
    }
    try {
      await endTeleopSession(pool, sessionId);
    } catch (error) {
      logger.error('endTeleopSession failed', { error: error.message, sessionId });
    }
  };

  (async () => {
    const row = await getActiveSessionForOperator(pool, {
      sessionId,
      teleoperatorId: user.id,
    });
    if (!row) {
      ws.close(4404, 'Session not found or ended');
      return;
    }

    if (reservedProxySessions.has(sessionId)) {
      ws.close(4409, 'Session already has an active connection');
      return;
    }
    reservedProxySessions.add(sessionId);

    const robot = registry.getById(row.robot_id);
    if (!robot) {
      reservedProxySessions.delete(sessionId);
      ws.close(4503, 'Robot not in registry');
      return;
    }

    const rosHost = robot.rosbridgeHost || robot.host;
    const rosPort = robot.rosbridgePort != null ? robot.rosbridgePort : 9090;
    const rosUrl = `ws://${rosHost}:${rosPort}`;
    const maxBytes = teleopCfg.maxMessageBytes;
    const connectTimeout = teleopCfg.rosbridgeConnectTimeoutMs;

    try {
      robotWs = new WebSocket(rosUrl);
    } catch (error) {
      logger.error('robot WebSocket create failed', { error: error.message, rosUrl });
      reservedProxySessions.delete(sessionId);
      ws.close(1011, 'Robot connection failed');
      return;
    }

    const timeout = setTimeout(() => {
      if (robotWs && robotWs.readyState !== WebSocket.OPEN) {
        try {
          robotWs.close();
        } catch {
          /* ignore */
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1011, 'Rosbridge connect timeout');
        }
        cleanupOnce();
      }
    }, connectTimeout);

    robotWs.on('open', () => {
      clearTimeout(timeout);
    });

    robotWs.on('message', (data, isBinary) => {
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }
      const len = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
      if (len > maxBytes) {
        return;
      }
      try {
        ws.send(data, { binary: isBinary });
      } catch {
        /* ignore */
      }
    });

    ws.on('message', (data, isBinary) => {
      if (!robotWs || robotWs.readyState !== WebSocket.OPEN) {
        return;
      }
      const len = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
      if (len > maxBytes) {
        return;
      }
      try {
        robotWs.send(data, { binary: isBinary });
      } catch {
        /* ignore */
      }
    });

    robotWs.on('error', (err) => {
      clearTimeout(timeout);
      logger.warn('robot bridge socket error', { error: err.message, sessionId });
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, 'Rosbridge error');
      }
      cleanupOnce();
    });

    robotWs.on('close', () => {
      clearTimeout(timeout);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      cleanupOnce();
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      cleanupOnce();
    });

    ws.on('error', () => {
      clearTimeout(timeout);
      cleanupOnce();
    });
  })().catch((error) => {
    logger.error('proxy session setup failed', { error: error.message, sessionId });
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, 'Internal error');
    }
    cleanupOnce();
  });
}

module.exports = { attachTeleopWebSockets };
