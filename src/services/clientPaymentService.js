const { Connection, PublicKey } = require('@solana/web3.js');
const logger = require('../utils/logger');

class ClientPaymentService {
  constructor({ solanaRpcUrl, commitment = 'confirmed' }) {
    this.connection = solanaRpcUrl 
      ? new Connection(solanaRpcUrl, commitment)
      : null;
    this.commitment = commitment;
  }

  isReady() {
    return Boolean(this.connection);
  }

  /**
   * Проверяет транзакцию на блокчейне
   */
  async verifyTransaction(signature, expectedReceiver, expectedAmount) {
    if (!this.connection) {
      throw new Error('Solana connection is not configured');
    }

    try {
      const transaction = await this.connection.getTransaction(signature, {
        commitment: this.commitment,
        maxSupportedTransactionVersion: 0,
      });

      if (!transaction) {
        return { valid: false, error: 'Transaction not found' };
      }

      if (!transaction.meta || transaction.meta.err) {
        return { valid: false, error: 'Transaction failed' };
      }

      // Проверяем получателя и сумму
      const postBalances = transaction.meta.postBalances;
      const preBalances = transaction.meta.preBalances;
      const accountKeys = transaction.transaction.message.accountKeys;

      let receiverFound = false;
      let amountTransferred = 0;

      for (let i = 0; i < accountKeys.length; i++) {
        const accountKey = accountKeys[i];
        if (accountKey.toString() === expectedReceiver) {
          receiverFound = true;
          const balanceChange = postBalances[i] - preBalances[i];
          if (balanceChange > 0) {
            amountTransferred = balanceChange;
          }
          break;
        }
      }

      if (!receiverFound) {
        return { valid: false, error: 'Receiver not found in transaction' };
      }

      const expectedLamports = Math.round(expectedAmount * 1_000_000_000);
      const tolerance = 1000; // Допуск в lamports для комиссий

      if (Math.abs(amountTransferred - expectedLamports) > tolerance) {
        return {
          valid: false,
          error: `Amount mismatch. Expected: ${expectedLamports}, Got: ${amountTransferred}`,
        };
      }

      return {
        valid: true,
        signature,
        receiver: expectedReceiver,
        amount: amountTransferred / 1_000_000_000,
        blockTime: transaction.blockTime,
      };
    } catch (error) {
      logger.error('Failed to verify transaction', { signature, error: error.message });
      return { valid: false, error: error.message };
    }
  }

  /**
   * Инициирует возврат средств (refund)
   * Требует настройки серверного кошелька
   */
  async initiateRefund(receiver, amount, reason) {
    // Это должно быть реализовано через серверный кошелек
    // Пока возвращаем заглушку
    logger.info('Refund initiated', { receiver, amount, reason });
    return {
      status: 'pending',
      receiver,
      amount,
      reason,
      message: 'Refund will be processed by server wallet',
    };
  }
}

module.exports = ClientPaymentService;
