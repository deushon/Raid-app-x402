# Клиентский UI для x402 Raid App

## Обзор

Создан публичный интерфейс для внешних пользователей с поддержкой оплаты через Solana кошельки и двумя режимами работы.

## Доступ

- **Публичный интерфейс**: `http://localhost:3000/client`
- **Админ панель** (защищена авторизацией): `http://localhost:3000/ui`

## Режимы работы

### Direct Mode
- Пользователь видит список всех доступных роботов
- Прямой выбор робота и действия
- Полный контроль над выбором исполнителя

### RAID Mode
- Индивидуальные роботы скрыты от пользователя
- Система автоматически выбирает оптимального исполнителя
- Использует AI агент для интеллектуального выбора

## Интеграция кошельков

Поддерживаются все SOL-совместимые кошельки:
- Phantom
- Backpack
- Solflare
- Другие кошельки с поддержкой стандарта Solana Wallet Adapter

## Платежный flow

1. Пользователь выбирает действие
2. Система показывает предварительную стоимость
3. Пользователь подключает кошелек
4. При выполнении действия:
   - Получение invoice от робота (если требуется оплата)
   - Подписание транзакции через кошелек
   - Отправка транзакции в блокчейн
   - Подтверждение оплаты роботу
   - Выполнение команды
5. При ошибке выполнения - автоматический возврат средств

## API Endpoints

### GET `/api/client/robots`
Получить список доступных роботов (для Direct режима)

### GET `/api/client/commands`
Получить список доступных команд (для RAID режима)

### POST `/api/client/estimate`
Получить предварительную стоимость действия
```json
{
  "mode": "direct" | "raid",
  "robotId": "robot-id", // для direct mode
  "command": "command-name",
  "parameters": {}
}
```

### POST `/api/client/execute`
Выполнить действие с клиентской оплатой
```json
{
  "mode": "direct" | "raid",
  "robotId": "robot-id", // для direct mode
  "command": "command-name",
  "parameters": {},
  "paymentSignature": "transaction-signature",
  "paymentTransaction": {
    "signature": "signature",
    "receiver": "wallet-address",
    "amount": 0.001,
    "asset": "SOL",
    "reference": "payment-reference"
  }
}
```

## AI Agent для выбора исполнителей

### Встроенные стратегии

- **smart** (по умолчанию): Умный выбор на основе цены, местоположения и доступности
- **lowest_price**: Выбор самого дешевого робота
- **closest**: Выбор ближайшего робота
- **fastest**: Выбор робота с самым свежим health check

### Интеграция с N8N

Для использования N8N для выбора исполнителей:

1. Создайте webhook в N8N
2. Установите переменную окружения:
   ```
   N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/robot-selection
   ```

N8N webhook должен принимать:
```json
{
  "robots": [...],
  "command": "command-name",
  "parameters": {},
  "context": {}
}
```

И возвращать:
```json
{
  "selectedRobotId": "robot-id",
  "reason": "Selection reason",
  "confidence": 0.9
}
```

## Конфигурация

### Переменные окружения

```bash
# Авторизация админ панели
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password

# AI Agent
AI_AGENT_STRATEGY=smart
N8N_WEBHOOK_URL=  # опционально

# Solana RPC (для проверки платежей)
X402_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

## Безопасность

- Админ панель защищена базовой HTTP авторизацией
- Платежи проверяются на блокчейне перед выполнением команды
- Автоматический возврат средств при ошибках выполнения
- Все транзакции подписываются пользователем через кошелек

## Разработка

### Структура файлов

```
public/client/
  ├── index.html      # HTML структура
  ├── styles.css      # Стили
  └── app.js          # JavaScript логика

src/
  ├── routes/
  │   └── client.js   # API роуты для клиентского UI
  ├── services/
  │   ├── clientPaymentService.js  # Сервис проверки платежей
  │   └── aiAgentService.js        # AI агент для выбора исполнителей
  └── middleware/
      └── auth.js     # Авторизация для админ панели
```

## Известные ограничения

1. Возврат средств требует настройки серверного кошелька (в разработке)
2. N8N интеграция опциональна, по умолчанию используются встроенные стратегии
3. Проверка платежей требует настройки Solana RPC URL
