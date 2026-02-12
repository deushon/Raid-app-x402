// Wallet integration uses global window.solana
const API_BASE = '/api/client';
let currentRpcUrl = 'https://solana-rpc.publicnode.com';

// Solana Web3.js is loaded via script tag in HTML
let SolanaWeb3 = null;
const loadSolanaWeb3 = () => {
  return new Promise((resolve) => {
    // Check if library is loaded
    if (window.solanaWeb3Ready && window.solanaWeb3) {
      SolanaWeb3 = window.solanaWeb3;
      resolve();
      return;
    }
    
    // Set ready handler
    window.onSolanaWeb3Ready = () => {
      if (window.solanaWeb3) {
        SolanaWeb3 = window.solanaWeb3;
      }
      resolve();
    };
    
    // Already loaded
    if (window.solanaWeb3Ready) {
      if (window.solanaWeb3) {
        SolanaWeb3 = window.solanaWeb3;
      }
      resolve();
      return;
    }
    
    // Timeout if library never loads
    setTimeout(() => {
      if (!SolanaWeb3) {
        console.warn('Solana Web3.js not loaded, wallet features may not work');
      }
      resolve();
    }, 3000);
  });
};

// LAMPORTS_PER_SOL for amount conversion
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
    await loadSettings();
    await loadSolanaWeb3();
    initConnection();
    setupEventListeners();
    loadMode();
  } catch (error) {
    console.error('Failed to load Solana Web3.js:', error);
    showNotification('Failed to load Solana library', 'error');
  }
});

function initConnection() {
  if (SolanaWeb3 && SolanaWeb3.Connection && currentRpcUrl) {
    connection = new SolanaWeb3.Connection(currentRpcUrl, 'confirmed');
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

async function loadSettings() {
  try {
    const res = await fetch(`${API_BASE}/settings`);
    const data = await res.json();
    if (data.solanaRpcUrl) {
      currentRpcUrl = data.solanaRpcUrl;
    }
  } catch (e) {
    console.warn('Could not load RPC settings from server', e);
  }
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
    direct: '<strong>Direct:</strong> Choose robot and action. Full control over executor.',
    raid: '<strong>RAID:</strong> System selects the best executor. Individual robots are hidden.',
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
  listEl.innerHTML = '<p class="loading">Loading robots...</p>';

  try {
    const response = await fetch(`${API_BASE}/robots`);
    const data = await response.json();

    if (!data.robots || data.robots.length === 0) {
      listEl.innerHTML = '<p class="loading">No robots available</p>';
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
    showNotification('Failed to load robots: ' + error.message, 'error');
    listEl.innerHTML = '<p class="loading">Load failed</p>';
  }
}

async function loadCommands() {
  const listEl = document.getElementById('commands-list');
  listEl.innerHTML = '<p class="loading">Loading actions...</p>';

  try {
    const response = await fetch(`${API_BASE}/commands`);
    const data = await response.json();

    if (!data.commands || data.commands.length === 0) {
      listEl.innerHTML = '<p class="loading">No actions available</p>';
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
    showNotification('Failed to load actions: ' + error.message, 'error');
    listEl.innerHTML = '<p class="loading">Load failed</p>';
  }
}

function renderRobot(robot) {
  const methods = robot.availableMethods || [];
  const methodsHtml = methods.map(method => {
    const methodKey = getMethodKey(method);
    const methodName = typeof method === 'string' ? method : (method.path || method.description || 'unknown');
    const methodPrice = typeof method === 'object' && method.pricing 
      ? `${method.pricing.amount} ${method.pricing.assetSymbol || 'SOL'}` 
      : 'Free';
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
      <div class="robot-methods">${methodsHtml || '<p>No methods available</p>'}</div>
    </div>
  `;
}

function renderCommand(cmd) {
  const price = cmd.pricing ? `${cmd.pricing.amount} ${cmd.pricing.assetSymbol || 'SOL'}` : 'Price TBD';
  
  return `
    <div class="command-card" data-command="${cmd.name}">
      <div class="command-name">${cmd.name}</div>
      <p class="command-description">${cmd.description || ''}</p>
      <p class="command-description"><strong>Price:</strong> ${price}</p>
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
    document.getElementById('action-form-title').textContent = `Execute: ${getMethodKey(currentAction.method)}`;
    form.innerHTML = buildActionForm(currentAction.method);
  } else {
    document.getElementById('action-form-title').textContent = `Execute: ${currentAction.command.name}`;
    form.innerHTML = buildActionForm(currentAction.command);
  }

  // Estimate price
  estimatePrice();
}

function buildActionForm(method) {
  if (typeof method === 'string') {
    return '<p>No parameters required</p>';
  }

  const params = method.parameters || {};
  if (Object.keys(params).length === 0) {
    return '<p>No parameters required</p>';
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
      showNotification('Could not determine cost', 'error');
    }
  } catch (error) {
    showNotification('Cost estimate error: ' + error.message, 'error');
  }
}

async function connectWallet() {
  // Support multiple Solana wallets
  let provider = null;

  // Check wallet providers
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
    showNotification('Solana wallet not found. Install Phantom, Backpack, Solflare or another Solana wallet.', 'error');
    return;
  }

  try {
    // Re-check Solana Web3 load (script may load after DOMContentLoaded)
    await loadSolanaWeb3();
    initConnection();

    // Connect wallet
    if (provider.connect) {
      await provider.connect();
    } else if (provider.isConnected && !provider.isConnected()) {
      await provider.connect();
    }

    // Get public key
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
      // Fallback: store as string if library not loaded
      walletPublicKey = typeof publicKey === 'string' ? publicKey : publicKey.toString();
    }

    updateWalletUI();
    await updateWalletBalance();

    showNotification('Wallet connected', 'success');
  } catch (error) {
    showNotification('Wallet connection error: ' + error.message, 'error');
  }
}

function disconnectWallet() {
  if (wallet && wallet.disconnect) {
    wallet.disconnect();
  }
  wallet = null;
  walletPublicKey = null;
  updateWalletUI();
  showNotification('Wallet disconnected', 'info');
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
    showNotification('Connect wallet to execute action', 'error');
    return;
  }

  try {
    // Get invoice from robot
    const invoice = await initiateCommand();
    
    if (!invoice) {
      showNotification('Could not get payment invoice', 'error');
      return;
    }

    // Show payment modal
    showPaymentModal(invoice);
  } catch (error) {
    showNotification('Command initiation error: ' + error.message, 'error');
  }
}

/**
 * Parse 402 response body into invoice (x402 V2 accepts[0] or legacy).
 */
function parse402Invoice(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.x402Version === 2 && Array.isArray(data.accepts) && data.accepts.length > 0) {
    const a = data.accepts[0];
    const ref = a?.extra?.reference;
    const payTo = a?.payTo;
    if (ref && payTo && (a?.amount != null) && a?.asset) {
      return { reference: ref, receiver: payTo, amount: a.amount, asset: a.asset };
    }
  }
  const ref = data.reference;
  const to = data.receiver ?? data.payTo;
  if (ref && to && (data.amount != null) && data.asset) {
    return { reference: ref, receiver: to, amount: data.amount, asset: data.asset };
  }
  return null;
}

/**
 * Collect parameters from #action-form container (div with inputs, not a form element).
 */
function getActionFormParameters() {
  const container = document.getElementById('action-form');
  const parameters = {};
  if (!container) return parameters;
  const inputs = container.querySelectorAll('input, select, textarea');
  inputs.forEach((el) => {
    const name = el.getAttribute('name');
    if (!name) return;
    if (el.type === 'checkbox' || el.type === 'radio') {
      if (el.checked) parameters[name] = el.value || 'on';
    } else {
      parameters[name] = el.value;
    }
  });
  return parameters;
}

async function initiateCommand() {
  if (!currentAction) {
    throw new Error('No action selected');
  }

  try {
    const parameters = getActionFormParameters();

    // Get invoice from robot
    let robot;
    let endpoint;
    let commandName;

    if (currentAction.mode === 'direct') {
      robot = currentAction.robot;
      commandName = getMethodKey(currentAction.method);
      
      // Resolve endpoint from method
      if (typeof currentAction.method === 'object' && currentAction.method.path) {
        endpoint = currentAction.method.path;
      } else {
        endpoint = `/commands/${commandName}`;
      }
    } else {
      // RAID mode: get selected robot from server
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

      // Get full robot list
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

    // Request robot for invoice
    const baseUrl = `http://${robot.host}:${robot.port}`;
    const url = `${baseUrl}${endpoint}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });

    if (response.status === 402) {
      // Got invoice (x402 V2 accepts[0] or legacy top-level)
      const data = await response.json();
      const invoice = parse402Invoice(data);
      if (!invoice) throw new Error('Invalid 402 response: missing payment details');
      return invoice;
    } else if (response.status === 200) {
      // Command executed without payment
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
    showNotification('Command initiation error: ' + error.message, 'error');
    throw error;
  }
}

function showPaymentModal(invoice) {
  const modal = document.getElementById('payment-modal');
  const details = document.getElementById('payment-details');
  
  details.innerHTML = `
    <p><strong>Receiver:</strong> ${invoice.receiver}</p>
    <p><strong>Amount:</strong> ${invoice.amount} ${invoice.asset}</p>
    <p><strong>Reference:</strong> ${invoice.reference}</p>
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
    showNotification('Error: no payment data', 'error');
    return;
  }

  const invoice = currentAction.invoice;
  const button = document.getElementById('confirm-payment');
  button.disabled = true;
  button.textContent = 'Processing...';

  try {
    if (!SolanaWeb3 || !SolanaWeb3.Transaction || !SolanaWeb3.SystemProgram) {
      throw new Error('Solana Web3.js library not loaded');
    }

    // Build transaction
    const transaction = new SolanaWeb3.Transaction().add(
      SolanaWeb3.SystemProgram.transfer({
        fromPubkey: typeof walletPublicKey === 'string' 
          ? new SolanaWeb3.PublicKey(walletPublicKey) 
          : walletPublicKey,
        toPubkey: new SolanaWeb3.PublicKey(invoice.receiver),
        lamports: Math.round(invoice.amount * LAMPORTS_PER_SOL),
      })
    );

    // Get latest blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = typeof walletPublicKey === 'string' 
      ? new SolanaWeb3.PublicKey(walletPublicKey) 
      : walletPublicKey;

    // Sign transaction
    const signed = await wallet.signTransaction(transaction);
    
    // Send transaction
    const signature = await connection.sendRawTransaction(signed.serialize());
    
    // Wait for confirmation
    await connection.confirmTransaction(signature, 'confirmed');

    // Close modal
    document.getElementById('payment-modal').classList.add('hidden');

    // Send confirmation to server
    await submitPaymentConfirmation(signature, invoice);

    showNotification('Payment completed', 'success');
    button.disabled = false;
    button.textContent = 'Confirm payment';
  } catch (error) {
    showNotification('Payment error: ' + error.message, 'error');
    button.disabled = false;
    button.textContent = 'Confirm payment';
  }
}

async function submitPaymentConfirmation(signature, invoice) {
  try {
    const parameters = getActionFormParameters();

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

    if (!response.ok) {
      const msg = result.details ? `${result.error}: ${result.details}` : (result.error || 'Server error');
      showNotification(msg, 'error');
      showExecutionStatus({ status: 'failed', error: msg });
      return;
    }

    if (result.refundRequired) {
      showNotification('Command failed. Refund will be processed.', 'info');
    }

    showExecutionStatus(result);
  } catch (error) {
    showNotification('Payment confirmation error: ' + error.message, 'error');
  }
}

function showExecutionStatus(result) {
  const section = document.getElementById('execution-status');
  const content = document.getElementById('status-content');
  
  section.classList.remove('hidden');
  
  content.innerHTML = `
    <div class="status-item ${result.status}">
      <p><strong>Status:</strong> ${result.status}</p>
      <p><strong>Message:</strong> ${result.message || 'No message'}</p>
      ${result.error ? `<p><strong>Error:</strong> ${result.error}</p>` : ''}
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
