const jwt = require('jsonwebtoken');

function jwtExpiresToMs(expiresIn) {
  const m = String(expiresIn).match(/^(\d+)([smhd])$/i);
  if (!m) {
    return 7 * 24 * 60 * 60 * 1000;
  }
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return n * (mult[unit] || mult.d);
}

function readTokenFromRequest(req, cookieName) {
  if (req.cookies && req.cookies[cookieName]) {
    return req.cookies[cookieName];
  }
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

/**
 * @param {{ jwtSecret: string, cookieName: string }} teleoperatorConfig
 */
function createAttachTeleopUser(teleoperatorConfig) {
  const { jwtSecret, cookieName } = teleoperatorConfig;

  return (req, res, next) => {
    const token = readTokenFromRequest(req, cookieName);
    if (!token) {
      return next();
    }
    try {
      const payload = jwt.verify(token, jwtSecret);
      const sub = payload.sub;
      if (!sub) {
        return next();
      }
      req.teleopUser = {
        id: sub,
        login: typeof payload.login === 'string' ? payload.login : undefined,
      };
    } catch {
      // invalid or expired token — treat as anonymous
    }
    return next();
  };
}

function createRequireTeleopSession({ mode = 'json', loginRedirect } = {}) {
  return (req, res, next) => {
    if (req.teleopUser?.id) {
      return next();
    }
    if (mode === 'redirect' && loginRedirect) {
      return res.redirect(302, loginRedirect);
    }
    return res.status(401).json({ error: 'Unauthorized' });
  };
}

function signTeleopToken(user, teleoperatorConfig) {
  return jwt.sign(
    { sub: user.id, login: user.login },
    teleoperatorConfig.jwtSecret,
    { expiresIn: teleoperatorConfig.jwtExpiresIn },
  );
}

function setTeleopCookie(res, token, teleoperatorConfig) {
  const maxAge = jwtExpiresToMs(teleoperatorConfig.jwtExpiresIn);
  res.cookie(teleoperatorConfig.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge,
    path: '/',
  });
}

function clearTeleopCookie(res, teleoperatorConfig) {
  res.clearCookie(teleoperatorConfig.cookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

module.exports = {
  createAttachTeleopUser,
  createRequireTeleopSession,
  signTeleopToken,
  setTeleopCookie,
  clearTeleopCookie,
  jwtExpiresToMs,
};
