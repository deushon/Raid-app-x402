const crypto = require('crypto');
const axios = require('axios');
const logger = require('../utils/logger');

class X402Service {
  constructor({
    privateKey,
    walletId,
    gatewayUrl,
    paymentEndpoint = '/v1/payments',
    paymentTimeoutMs = 10000,
  }) {
    this.privateKey = privateKey;
    this.walletId = walletId;
    this.gatewayUrl = gatewayUrl;
    this.paymentEndpoint = paymentEndpoint;
    this.paymentTimeoutMs = paymentTimeoutMs;
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

  resolveGatewayUrl(endpoint) {
    if (!this.gatewayUrl) {
      throw new Error('x402 gateway URL is not configured');
    }
    if (!endpoint) {
      return this.gatewayUrl;
    }
    try {
      const resolved = new URL(endpoint, this.gatewayUrl);
      return resolved.toString();
    } catch (error) {
      logger.error('Failed to resolve x402 gateway URL', { endpoint, error: error.message });
      throw error;
    }
  }

  async settleInvoice(invoice) {
    if (!this.isConfigured()) {
      throw new Error('x402 private key is not configured');
    }

    if (!invoice) {
      throw new Error('Payment invoice payload is missing');
    }

    const { reference, receiver, amount, asset } = invoice;
    const numericAmount = typeof amount === 'string' ? Number(amount) : amount;
    if (!reference || !receiver || Number.isNaN(numericAmount) || !Number.isFinite(numericAmount) || !asset) {
      throw new Error('Payment invoice is missing required fields (reference, receiver, amount, asset)');
    }

    const payload = {
      reference,
      receiver,
      amount: numericAmount,
      asset,
    };

    const url = this.resolveGatewayUrl(this.paymentEndpoint);
    logger.info('Settling x402 invoice', { url, reference, receiver, amount, asset });

    try {
      const response = await this.sendSecuredRequest({
        url,
        method: 'POST',
        data: payload,
        timeout: this.paymentTimeoutMs,
      });
      return response.data;
    } catch (error) {
      logger.error('x402 payment settlement failed', {
        reference,
        receiver,
        status: error.response?.status,
        error: error.message,
      });
      throw error;
    }
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

