const path = require('path');
const fs = require('fs');
const { buildSolanaRpcUrl } = require('../config');
const logger = require('../utils/logger');

const SETTINGS_FILE = path.join(process.cwd(), 'config', 'client-settings.json');

let runtimeOverrides = {};
let configSnapshot = null;

/**
 * Инициализация хранилища: загружаем сохранённые настройки из файла и снимок config.
 */
function init(config) {
  configSnapshot = config;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
      runtimeOverrides = JSON.parse(raw);
      logger.debug('Client settings loaded from file', { file: SETTINGS_FILE });
    }
  } catch (error) {
    logger.warn('Could not load client settings file', { path: SETTINGS_FILE, error: error.message });
  }
}

/**
 * Текущие настройки RPC (для отдачи клиенту; API ключ маскируем).
 */
function getSettings() {
  const solana = configSnapshot?.x402?.solana || {};
  const provider = runtimeOverrides.rpcProvider ?? solana.rpcProvider ?? 'public';
  const heliusApiKey = runtimeOverrides.heliusApiKey ?? solana.heliusApiKey;
  const customRpcUrl = runtimeOverrides.customRpcUrl ?? (solana.rpcProvider === 'custom' ? solana.rpcUrl : null);

  const solanaRpcUrl = getSolanaRpcUrl();

  return {
    solanaRpcUrl,
    rpcProvider: provider,
    hasHeliusKey: Boolean(heliusApiKey),
    customRpcUrl: customRpcUrl || null,
  };
}

/**
 * Итоговый Solana RPC URL: сначала runtime (UI), потом config/env.
 */
function getSolanaRpcUrl() {
  const solana = configSnapshot?.x402?.solana || {};
  const provider = runtimeOverrides.rpcProvider ?? solana.rpcProvider ?? 'public';
  const heliusApiKey = runtimeOverrides.heliusApiKey ?? solana.heliusApiKey;
  const customRpcUrl = runtimeOverrides.customRpcUrl ?? solana.rpcUrl;

  return buildSolanaRpcUrl({
    rpcProvider: provider,
    heliusApiKey: heliusApiKey || null,
    rpcUrl: customRpcUrl || null,
  });
}

/**
 * Сохранить настройки из UI (rpcProvider, heliusApiKey?, customRpcUrl?).
 */
function saveSettings(settings) {
  if (settings.rpcProvider !== undefined) {
    runtimeOverrides.rpcProvider = settings.rpcProvider;
  }
  if (settings.heliusApiKey !== undefined) {
    runtimeOverrides.heliusApiKey = settings.heliusApiKey || null;
  }
  if (settings.customRpcUrl !== undefined) {
    runtimeOverrides.customRpcUrl = settings.customRpcUrl || null;
  }

  try {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(runtimeOverrides, null, 2), 'utf8');
    logger.info('Client settings saved', { rpcProvider: runtimeOverrides.rpcProvider });
  } catch (error) {
    logger.error('Failed to save client settings', { error: error.message });
    throw error;
  }

  return getSettings();
}

module.exports = {
  init,
  getSettings,
  getSolanaRpcUrl,
  saveSettings,
};
