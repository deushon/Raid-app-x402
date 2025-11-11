const path = require('path');
const dotenv = require('dotenv');
const logger = require('./utils/logger');

const loadEnvFile = () => {
  const explicitPath = process.env.DOTENV_CONFIG_PATH;
  const envPath = explicitPath || path.join(process.cwd(), '.env');
  try {
    dotenv.config({ path: envPath });
    logger.debug('Environment configuration loaded', { envPath });
  } catch (error) {
    logger.warn('Failed to load environment configuration file', { error: error.message });
  }
};

const parseArgs = (rawArgs = []) => {
  const args = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (token === '--') {
      continue;
    }

    if (!token.startsWith('--')) {
      continue;
    }

    const [keyPart, ...valueParts] = token.slice(2).split('=');
    if (valueParts.length > 0) {
      const value = valueParts.join('=');
      args[keyPart] = value.replace(/^"(.*)"$/, '$1');
      continue;
    }

    const nextToken = rawArgs[index + 1];
    if (nextToken && !nextToken.startsWith('--')) {
      args[keyPart] = nextToken.replace(/^"(.*)"$/, '$1');
      index += 1;
    } else {
      args[keyPart] = true;
    }
  }
  return args;
};

const toNumber = (value, fallback) => {
  if (value === undefined || value === null) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const loadConfig = (argv = []) => {
  loadEnvFile();
  const args = parseArgs(argv);

  const privateKey = args['x402-private-key'] || process.env.X402_PRIVATE_KEY || null;
  const walletId = args['x402-wallet-id'] || process.env.X402_WALLET_ID || null;

  if (!privateKey) {
    logger.warn('x402 private key is not configured. Outgoing payments will fail until configured.');
  }

  return {
    server: {
      host: process.env.HOST || args.host || '0.0.0.0',
      port: toNumber(args.port || process.env.PORT, 3000),
    },
    x402: {
      privateKey,
      walletId,
      gatewayUrl: args['x402-gateway-url'] || process.env.X402_GATEWAY_URL || 'https://api.corbits.dev',
      paymentEndpoint: args['x402-payment-endpoint'] || process.env.X402_PAYMENT_ENDPOINT || '/v1/payments',
      paymentTimeoutMs: toNumber(
        args['x402-payment-timeout'] || process.env.X402_PAYMENT_TIMEOUT_MS,
        10000,
      ),
    },
    robots: {
      healthTimeoutMs: toNumber(args['robot-health-timeout'] || process.env.ROBOT_HEALTH_TIMEOUT_MS, 5000),
      commandTimeoutMs: toNumber(args['robot-command-timeout'] || process.env.ROBOT_COMMAND_TIMEOUT_MS, 8000),
      defaultHealthEndpoint: args['robot-health-endpoint'] || process.env.ROBOT_HEALTH_ENDPOINT || '/health',
      defaultSecureHealthEndpoint: args['robot-secure-health-endpoint'] || process.env.ROBOT_SECURE_HEALTH_ENDPOINT || '/helth',
    },
  };
};

module.exports = {
  loadConfig,
  parseArgs,
};

