const path = require('path');
const fs = require('fs');

/**
 * Public Tailwind bundle used by /client, /teleoperator, and shared admin HTML that
 * links to /styles.css (not only /ui/styles.css).
 */
function registerPublicTailwindCss(app, publicRoot, logger) {
  app.get('/styles.css', (req, res) => {
    const file = path.join(publicRoot, 'styles.css');
    res.type('text/css');
    res.sendFile(file, (err) => {
      if (err) {
        if (logger?.warn) {
          logger.warn('styles.css not sent', { error: err.message });
        }
        res.status(503).type('text/plain').send('styles.css missing; run npm run build:css');
      }
    });
  });
}

function publicStylesPath(publicRoot) {
  return path.join(publicRoot, 'styles.css');
}

function publicStylesExists(publicRoot) {
  return fs.existsSync(publicStylesPath(publicRoot));
}

module.exports = {
  registerPublicTailwindCss,
  publicStylesPath,
  publicStylesExists,
};
