const crypto = require('crypto');
const axios = require('axios');
const logger = require('../utils/logger');

class X402Service {
  constructor({ privateKey, walletId, gatewayUrl }) {
    this.privateKey = privateKey;
    this.walletId = walletId;
    this.gatewayUrl = gatewayUrl;
  }

  isConfigured() {
    return Boolean(this.privateKey);
  }

  buildSignature(payload) {
    if (!this.isConfigured()) {
      throw new Error('x402 private key is not configured');
    }

    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const signer = crypto.createHmac('sha256', this.privateKey);
    signer.update(serialized);
    return signer.digest('hex');
  }

  buildHeaders(payload, overrideHeaders = {}) {
    const headers = {
      ...overrideHeaders,
    };

    if (this.walletId) {
      headers['x-402-wallet'] = this.walletId;
    }

    try {
      headers['x-402-signature'] = this.buildSignature(payload);
    } catch (error) {
      logger.error('Failed to sign payload for x402 headers', { error: error.message });
      throw error;
    }

    return headers;
  }

  async sendSecuredRequest(options) {
    if (!this.isConfigured()) {
      throw new Error('x402 private key is not configured');
    }

    const {
      url,
      method = 'GET',
      data = undefined,
      headers = {},
      timeout = 8000,
      params = undefined,
    } = options;

    const payloadForSignature = data || params || {};
    const signedHeaders = this.buildHeaders(payloadForSignature, headers);

    logger.debug('Dispatching x402 protected request', { url, method });
    return axios({
      url,
      method,
      data,
      params,
      timeout,
      headers: signedHeaders,
    });
  }

  createHttpClient(baseURL, defaultOptions = {}) {
    if (!this.isConfigured()) {
      throw new Error('x402 private key is not configured');
    }

    const client = axios.create({
      baseURL,
      timeout: defaultOptions.timeout ?? 8000,
    });

    client.interceptors.request.use((config) => {
      const payloadForSignature = config.data || config.params || {};
      const mergedHeaders = this.buildHeaders(payloadForSignature, config.headers);
      return {
        ...config,
        headers: mergedHeaders,
      };
    });

    return client;
  }

  verifyIncomingSignature({ signature, payload }) {
    if (!this.isConfigured()) {
      logger.warn('Attempted to verify x402 signature without configured private key');
      return false;
    }

    if (!signature) {
      return false;
    }

    try {
      const expected = this.buildSignature(payload);
      return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch (error) {
      logger.error('Failed to verify x402 signature', { error: error.message });
      return false;
    }
  }
}

module.exports = X402Service;

