// Wallet integration - используем глобальный объект window.solana
const API_BASE = '/api/client';
const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com'; // Можно сделать настраиваемым

// Solana Web3.js загружается через script tag в HTML
let SolanaWeb3 = null;
const loadSolanaWeb3 = () => {
  return new Promise((resolve) => {
    // Проверяем, загружена ли библиотека
    if (window.solanaWeb3Ready && window.solanaWeb3) {
      SolanaWeb3 = window.solanaWeb3;
      resolve();
      return;
    }
    
    // Устанавливаем обработчик готовности
    window.onSolanaWeb3Ready = () => {
      if (window.solanaWeb3) {
        SolanaWeb3 = window.solanaWeb3;
      }
      resolve();
    };
    
    // Если уже загружено
    if (window.solanaWeb3Ready) {
      if (window.solanaWeb3) {
        SolanaWeb3 = window.solanaWeb3;
      }
      resolve();
      return;
    }
    
    // Таймаут на случай, если библиотека не загрузится
    setTimeout(() => {
      if (!SolanaWeb3) {
        console.warn('Solana Web3.js not loaded, wallet features may not work');
      }
      resolve();
    }, 3000);
  });
};

// Альтернатива: используем fetch для работы с Solana RPC напрямую
const LAMPORTS_PER_SOL = 1_000_000_000;

// State
let currentMode = 'direct'; // 'direct' | 'raid'
let wallet = null;
let walletPublicKey = null;
let connection = null;
let currentAction = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadSolanaWeb3();
    initConnection();
    setupEventListeners();
    loadMode();
  } catch (error) {
    console.error('Failed to load Solana Web3.js:', error);
    showNotification('Ошибка загрузки Solana библиотеки', 'error');
  }
});

function initConnection() {
  if (SolanaWeb3 && SolanaWeb3.Connection) {
    connection = new SolanaWeb3.Connection(SOLANA_RPC_URL, 'confirmed');
  }
}

function setupEventListeners() {
  // Mode selection
  document.getElementById('mode-direct').addEventListener('click', () => setMode('direct'));
  document.getElementById('mode-raid').addEventListener('click', () => setMode('raid'));

  // Wallet
  document.getElementById('connect-wallet').addEventListener('click', connectWallet);
  document.getElementById('disconnect-wallet').addEventListener('click', disconnectWallet);

  // Action execution
  document.getElementById('execute-action').addEventListener('click', executeAction);
  document.getElementById('confirm-payment').addEventListener('click', confirmPayment);
  document.getElementById('cancel-payment').addEventListener('click', cancelPayment);
}

function setMode(mode) {
  currentMode = mode;
  document.getElementById('mode-direct').classList.toggle('active', mode === 'direct');
  document.getElementById('mode-raid').classList.toggle('active', mode === 'raid');
  
  document.getElementById('direct-mode').classList.toggle('hidden', mode !== 'direct');
  document.getElementById('raid-mode').classList.toggle('hidden', mode !== 'raid');
  
  document.getElementById('action-form-section').classList.add('hidden');
  document.getElementById('execution-status').classList.add('hidden');

  const descriptions = {
    direct: '<strong>Direct:</strong> Выберите робота и действие напрямую. Полный контроль над выбором исполнителя.',
    raid: '<strong>RAID:</strong> Система автоматически выберет оптимального исполнителя. Индивидуальные роботы скрыты.',
  };
  document.getElementById('mode-description').innerHTML = descriptions[mode];

  loadMode();
}

function loadMode() {
  if (currentMode === 'direct') {
    loadRobots();
  } else {
    loadCommands();
  }
}

async function loadRobots() {
  const listEl = document.getElementById('robots-list');
  listEl.innerHTML = '<p class="loading">Загрузка роботов...</p>';

  try {
    const response = await fetch(`${API_BASE}/robots`);
    const data = await response.json();

    if (!data.robots || data.robots.length === 0) {
      listEl.innerHTML = '<p class="loading">Нет доступных роботов</p>';
      return;
    }

    listEl.innerHTML = data.robots.map(robot => renderRobot(robot)).join('');
    
    // Add event listeners for method selection
    data.robots.forEach(robot => {
      robot.availableMethods.forEach(method => {
        const methodKey = getMethodKey(method);
        const methodEl = document.querySelector(`[data-robot-id="${robot.id}"][data-method="${methodKey}"]`);
        if (methodEl) {
          methodEl.addEventListener('click', () => selectAction(robot, method));
        }
      });
    });
  } catch (error) {
    showNotification('Ошибка загрузки роботов: ' + error.message, 'error');
    listEl.innerHTML = '<p class="loading">Ошибка загрузки</p>';
  }
}

async function loadCommands() {
  const listEl = document.getElementById('commands-list');
  listEl.innerHTML = '<p class="loading">Загрузка действий...</p>';

  try {
    const response = await fetch(`${API_BASE}/commands`);
    const data = await response.json();

    if (!data.commands || data.commands.length === 0) {
      listEl.innerHTML = '<p class="loading">Нет доступных действий</p>';
      return;
    }

    listEl.innerHTML = data.commands.map(cmd => renderCommand(cmd)).join('');
    
    // Add event listeners
    data.commands.forEach(cmd => {
      const cmdEl = document.querySelector(`[data-command="${cmd.name}"]`);
      if (cmdEl) {
        cmdEl.addEventListener('click', () => selectCommand(cmd));
      }
    });
  } catch (error) {
    showNotification('Ошибка загрузки действий: ' + error.message, 'error');
    listEl.innerHTML = '<p class="loading">Ошибка загрузки</p>';
  }
}

function renderRobot(robot) {
  const methods = robot.availableMethods || [];
  const methodsHtml = methods.map(method => {
    const methodKey = getMethodKey(method);
    const methodName = typeof method === 'string' ? method : (method.path || method.description || 'unknown');
    const methodPrice = typeof method === 'object' && method.pricing 
      ? `${method.pricing.amount} ${method.pricing.assetSymbol || 'SOL'}` 
      : 'Бесплатно';
    const methodDesc = typeof method === 'object' ? (method.description || '') : '';

    return `
      <div class="method-item" data-robot-id="${robot.id}" data-method="${methodKey}">
        <div class="method-item-header">
          <span class="method-name">${methodName}</span>
          <span class="method-price">${methodPrice}</span>
        </div>
        ${methodDesc ? `<p class="method-description">${methodDesc}</p>` : ''}
      </div>
    `;
  }).join('');

  return `
    <div class="robot-card">
      <div class="robot-header">
        <span class="robot-name">${robot.name}</span>
        <span class="robot-status ${robot.status}">${robot.status.toUpperCase()}</span>
      </div>
      <div class="robot-methods">${methodsHtml || '<p>Нет доступных методов</p>'}</div>
    </div>
  `;
}

function renderCommand(cmd) {
  const price = cmd.pricing ? `${cmd.pricing.amount} ${cmd.pricing.assetSymbol || 'SOL'}` : 'Цена уточняется';
  
  return `
    <div class="command-card" data-command="${cmd.name}">
      <div class="command-name">${cmd.name}</div>
      <p class="command-description">${cmd.description || ''}</p>
      <p class="command-description"><strong>Цена:</strong> ${price}</p>
    </div>
  `;
}

function getMethodKey(method) {
  if (typeof method === 'string') return method;
  return method.path || method.description || 'unknown';
}

function selectAction(robot, method) {
  currentAction = {
    mode: 'direct',
    robot,
    method,
  };
  showActionForm();
}

function selectCommand(cmd) {
  currentAction = {
    mode: 'raid',
    command: cmd,
  };
  showActionForm();
}

function showActionForm() {
  const section = document.getElementById('action-form-section');
  const form = document.getElementById('action-form');
  const preview = document.getElementById('action-preview');
  
  section.classList.remove('hidden');
  preview.classList.add('hidden');
  
  if (currentAction.mode === 'direct') {
    document.getElementById('action-form-title').textContent = `Выполнение: ${getMethodKey(currentAction.method)}`;
    form.innerHTML = buildActionForm(currentAction.method);
  } else {
    document.getElementById('action-form-title').textContent = `Выполнение: ${currentAction.command.name}`;
    form.innerHTML = buildActionForm(currentAction.command);
  }

  // Estimate price
  estimatePrice();
}

function buildActionForm(method) {
  if (typeof method === 'string') {
    return '<p>Параметры не требуются</p>';
  }

  const params = method.parameters || {};
  if (Object.keys(params).length === 0) {
    return '<p>Параметры не требуются</p>';
  }

  let html = '';
  if (params.kwargs) {
    Object.entries(params.kwargs).forEach(([key, value]) => {
      html += `
        <div class="form-group">
          <label>${key}</label>
          <input type="text" name="${key}" value="${value || ''}" />
        </div>
      `;
    });
  }
  return html;
}

async function estimatePrice() {
  try {
    const payload = {
      mode: currentAction.mode,
    };

    if (currentAction.mode === 'direct') {
      payload.robotId = currentAction.robot.id;
      payload.command = getMethodKey(currentAction.method);
    } else {
      payload.command = currentAction.command.name;
    }

    const response = await fetch(`${API_BASE}/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.estimatedPrice !== null) {
      document.getElementById('preview-price').textContent = data.estimatedPrice;
      document.getElementById('preview-robot').textContent = data.robot.name;
      document.getElementById('preview-action').textContent = 
        currentAction.mode === 'direct' ? getMethodKey(currentAction.method) : currentAction.command.name;
      
      document.getElementById('action-preview').classList.remove('hidden');
      document.getElementById('execute-action').disabled = !walletPublicKey;
    } else {
      showNotification('Не удалось определить стоимость', 'error');
    }
  } catch (error) {
    showNotification('Ошибка расчета стоимости: ' + error.message, 'error');
  }
}

async function connectWallet() {
  // Поддержка различных Solana кошельков
  let provider = null;

  // Проверяем различные варианты
  if (typeof window.solana !== 'undefined') {
    provider = window.solana;
  } else if (typeof window.solflare !== 'undefined') {
    provider = window.solflare;
  } else if (typeof window.backpack !== 'undefined') {
    provider = window.backpack;
  } else if (typeof window.phantom !== 'undefined') {
    provider = window.phantom;
  }

  if (!provider) {
    showNotification('Solana кошелек не найден. Установите Phantom, Backpack, Solflare или другой Solana кошелек.', 'error');
    return;
  }

  try {
    // Подключаемся к кошельку
    if (provider.connect) {
      await provider.connect();
    } else if (provider.isConnected && !provider.isConnected()) {
      await provider.connect();
    }

    // Получаем публичный ключ
    let publicKey;
    if (provider.publicKey) {
      publicKey = provider.publicKey;
    } else if (provider.publicKeyBase58) {
      publicKey = provider.publicKeyBase58;
    } else {
      throw new Error('Unable to get public key from wallet');
    }

    wallet = provider;
    if (SolanaWeb3 && SolanaWeb3.PublicKey) {
      walletPublicKey = typeof publicKey === 'string' 
        ? new SolanaWeb3.PublicKey(publicKey)
        : publicKey;
    } else {
      // Fallback: сохраняем как строку, если библиотека не загружена
      walletPublicKey = typeof publicKey === 'string' ? publicKey : publicKey.toString();
    }

    updateWalletUI();
    await updateWalletBalance();

    showNotification('Кошелек подключен', 'success');
  } catch (error) {
    showNotification('Ошибка подключения кошелька: ' + error.message, 'error');
  }
}

function disconnectWallet() {
  if (wallet && wallet.disconnect) {
    wallet.disconnect();
  }
  wallet = null;
  walletPublicKey = null;
  updateWalletUI();
  showNotification('Кошелек отключен', 'info');
}

function updateWalletUI() {
  const statusEl = document.getElementById('wallet-status');
  const infoEl = document.getElementById('wallet-info');

  if (walletPublicKey) {
    statusEl.classList.add('hidden');
    infoEl.classList.remove('hidden');
    const address = typeof walletPublicKey === 'string' 
      ? walletPublicKey 
      : walletPublicKey.toBase58();
    document.getElementById('wallet-address').textContent = 
      address.slice(0, 8) + '...' + address.slice(-8);
  } else {
    statusEl.classList.remove('hidden');
    infoEl.classList.add('hidden');
  }
}

async function updateWalletBalance() {
  if (!walletPublicKey || !connection) return;

  try {
    const balance = await connection.getBalance(walletPublicKey);
    const solBalance = balance / LAMPORTS_PER_SOL;
    document.getElementById('wallet-balance').textContent = solBalance.toFixed(4);
  } catch (error) {
    console.error('Failed to fetch balance:', error);
  }
}

async function executeAction() {
  if (!walletPublicKey) {
    showNotification('Подключите кошелек для выполнения действия', 'error');
    return;
  }

  try {
    // Получаем invoice от робота
    const invoice = await initiateCommand();
    
    if (!invoice) {
      showNotification('Не удалось получить счет на оплату', 'error');
      return;
    }

    // Показываем модальное окно оплаты
    showPaymentModal(invoice);
  } catch (error) {
    showNotification('Ошибка инициации команды: ' + error.message, 'error');
  }
}

async function initiateCommand() {
  if (!currentAction) {
    throw new Error('No action selected');
  }

  try {
    // Определяем параметры команды
    const form = document.getElementById('action-form');
    const formData = new FormData(form);
    const parameters = {};
    
    for (const [key, value] of formData.entries()) {
      parameters[key] = value;
    }

    // Получаем invoice от робота
    let robot;
    let endpoint;
    let commandName;

    if (currentAction.mode === 'direct') {
      robot = currentAction.robot;
      commandName = getMethodKey(currentAction.method);
      
      // Определяем endpoint из метода
      if (typeof currentAction.method === 'object' && currentAction.method.path) {
        endpoint = currentAction.method.path;
      } else {
        endpoint = `/commands/${commandName}`;
      }
    } else {
      // RAID mode - нужно получить выбранного робота от сервера
      const estimateResponse = await fetch(`${API_BASE}/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'raid',
          command: currentAction.command.name,
        }),
      });

      const estimateData = await estimateResponse.json();
      if (!estimateData.robot) {
        throw new Error('No robot selected for RAID mode');
      }

      // Получаем полную информацию о роботе
      const robotsResponse = await fetch(`${API_BASE}/robots`);
      const robotsData = await robotsResponse.json();
      robot = robotsData.robots.find(r => r.id === estimateData.robot.id);
      
      if (!robot) {
        throw new Error('Selected robot not found');
      }

      commandName = currentAction.command.name;
      endpoint = currentAction.command.httpMethod 
        ? `${currentAction.command.httpMethod} ${currentAction.command.name}`
        : `/commands/${commandName}`;
    }

    // Отправляем запрос роботу для получения invoice
    const baseUrl = `http://${robot.host}:${robot.port}`;
    const url = `${baseUrl}${endpoint}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });

    if (response.status === 402) {
      // Получили invoice
      const invoice = await response.json();
      return invoice;
    } else if (response.status === 200) {
      // Команда выполнена без оплаты
      const result = await response.json();
      showExecutionStatus({
        status: 'success',
        message: 'Command executed successfully',
        response: result,
      });
      return null;
    } else {
      throw new Error(`Robot returned status ${response.status}`);
    }
  } catch (error) {
    showNotification('Ошибка инициации команды: ' + error.message, 'error');
    throw error;
  }
}

function showPaymentModal(invoice) {
  const modal = document.getElementById('payment-modal');
  const details = document.getElementById('payment-details');
  
  details.innerHTML = `
    <p><strong>Получатель:</strong> ${invoice.receiver}</p>
    <p><strong>Сумма:</strong> ${invoice.amount} ${invoice.asset}</p>
    <p><strong>Ссылка:</strong> ${invoice.reference}</p>
  `;
  
  modal.classList.remove('hidden');
  currentAction.invoice = invoice;
}

function cancelPayment() {
  document.getElementById('payment-modal').classList.add('hidden');
  currentAction.invoice = null;
}

async function confirmPayment() {
  if (!currentAction.invoice || !walletPublicKey) {
    showNotification('Ошибка: нет данных для оплаты', 'error');
    return;
  }

  const invoice = currentAction.invoice;
  const button = document.getElementById('confirm-payment');
  button.disabled = true;
  button.textContent = 'Обработка...';

  try {
    if (!SolanaWeb3 || !SolanaWeb3.Transaction || !SolanaWeb3.SystemProgram) {
      throw new Error('Solana Web3.js library not loaded');
    }

    // Создаем транзакцию
    const transaction = new SolanaWeb3.Transaction().add(
      SolanaWeb3.SystemProgram.transfer({
        fromPubkey: typeof walletPublicKey === 'string' 
          ? new SolanaWeb3.PublicKey(walletPublicKey) 
          : walletPublicKey,
        toPubkey: new SolanaWeb3.PublicKey(invoice.receiver),
        lamports: Math.round(invoice.amount * LAMPORTS_PER_SOL),
      })
    );

    // Получаем последний blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = typeof walletPublicKey === 'string' 
      ? new SolanaWeb3.PublicKey(walletPublicKey) 
      : walletPublicKey;

    // Подписываем транзакцию
    const signed = await wallet.signTransaction(transaction);
    
    // Отправляем транзакцию
    const signature = await connection.sendRawTransaction(signed.serialize());
    
    // Ждем подтверждения
    await connection.confirmTransaction(signature, 'confirmed');

    // Закрываем модальное окно
    document.getElementById('payment-modal').classList.add('hidden');

    // Отправляем подтверждение на сервер
    await submitPaymentConfirmation(signature, invoice);

    showNotification('Оплата успешно выполнена', 'success');
    button.disabled = false;
    button.textContent = 'Подтвердить оплату';
  } catch (error) {
    showNotification('Ошибка оплаты: ' + error.message, 'error');
    button.disabled = false;
    button.textContent = 'Подтвердить оплату';
  }
}

async function submitPaymentConfirmation(signature, invoice) {
  try {
    // Собираем параметры команды
    const form = document.getElementById('action-form');
    const formData = new FormData(form);
    const parameters = {};
    
    for (const [key, value] of formData.entries()) {
      parameters[key] = value;
    }

    const response = await fetch(`${API_BASE}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: currentAction.mode,
        robotId: currentAction.mode === 'direct' ? currentAction.robot.id : null,
        command: currentAction.mode === 'direct' 
          ? getMethodKey(currentAction.method) 
          : currentAction.command.name,
        parameters,
        paymentSignature: signature,
        paymentTransaction: {
          signature,
          receiver: invoice.receiver,
          amount: invoice.amount,
          asset: invoice.asset,
          reference: invoice.reference,
        },
      }),
    });

    const result = await response.json();
    
    if (result.refundRequired) {
      showNotification('Команда не выполнена. Возврат средств будет обработан.', 'info');
    }
    
    showExecutionStatus(result);
  } catch (error) {
    showNotification('Ошибка подтверждения оплаты: ' + error.message, 'error');
  }
}

function showExecutionStatus(result) {
  const section = document.getElementById('execution-status');
  const content = document.getElementById('status-content');
  
  section.classList.remove('hidden');
  
  content.innerHTML = `
    <div class="status-item ${result.status}">
      <p><strong>Статус:</strong> ${result.status}</p>
      <p><strong>Сообщение:</strong> ${result.message || 'Нет сообщения'}</p>
      ${result.error ? `<p><strong>Ошибка:</strong> ${result.error}</p>` : ''}
    </div>
  `;
}

function showNotification(message, type = 'info') {
  const notifications = document.getElementById('notifications');
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  
  notifications.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 5000);
}

// Listen for wallet events
window.addEventListener('load', () => {
  if (window.solana && window.solana.isPhantom) {
    window.solana.on('connect', () => {
      if (window.solana.publicKey) {
        wallet = window.solana;
        if (SolanaWeb3 && SolanaWeb3.PublicKey) {
          walletPublicKey = new SolanaWeb3.PublicKey(window.solana.publicKey);
        } else {
          walletPublicKey = window.solana.publicKey.toString();
        }
        updateWalletUI();
        updateWalletBalance();
      }
    });

    window.solana.on('disconnect', () => {
      disconnectWallet();
    });
  }
});
