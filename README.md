# x402 Raid Control Service

Node.js (Express) сервис, который оркестрирует x402-платежи и вызовы роботов. Есть **публичный клиентский UI** (`/client`), **админ-панель** (`/ui`, Basic Auth), REST API для реестра роботов, высокоуровневых команд и **клиентского потока** (оценка, инвойс 402, оплата в браузере, выполнение с `X-X402-Reference`).

## Возможности

- **x402 V2** при вызовах роботов: первый запрос → **402** с `accepts[]` → оплата (шлюз или прямой Solana) → повтор с **`X-X402-Reference`** (см. [docs/X402_PROTOCOL.md](docs/X402_PROTOCOL.md)).
- Провайдеры оплат: внешний x402 gateway или **solana-direct** (`@solana/web3.js`).
- Мониторинг здоровья роботов: опрос `/health` и legacy `/helth` (x402 при необходимости).
- Реестр роботов в памяти: статус, методы, координаты.
- **Command router**: `dance`, `buy-cola` с выбором исполнителя (цена, порядок, случайно / ближайший к точке).
- **Режим RAID для клиента**: выбор робота через **AIAgentService** (стратегии или webhook **n8n**), настраивается в админке.
- **ClientPaymentService**: проверка Solana-транзакции и задел под refund при сбое выполнения.
- **OpenAPI**: Swagger UI `/docs`, JSON `/docs-json` (см. `src/docs/swagger.js` и JSDoc `@openapi` в роутерах).
- **Телеоператор** (при настроенном `DATABASE_URL`): регистрация и вход (логин + пароль), в PostgreSQL хранится **bcrypt**-хеш пароля и **открытый** Solana `walletPublicKey`; сессия — **JWT** в httpOnly-cookie `teleop_token`. Личный кабинет `/teleoperator/cabinet` (заглушка для VR). В будущем можно добавить оффчейн-вход по подписи кошелька.

## Быстрый старт

### Требования

- Node.js 18+
- npm 9+
- Для защищённых роботов и серверных оплат: `X402_PRIVATE_KEY` (и при необходимости ключ для Solana).
- Для телеоператора: **PostgreSQL** и переменные `DATABASE_URL`, `TELEOPERATOR_JWT_SECRET` (см. ниже). Без `DATABASE_URL` маршруты `/api/teleoperator/*` и UI `/teleoperator` **не подключаются**.

### Установка и запуск

```bash
npm install
cp config/env.example .env   # при необходимости отредактируйте
# Опционально: PostgreSQL для телеоператора
docker compose up -d
npm run start                # продакшен
npm run dev                  # nodemon
```

Сервер слушает `HOST` / `PORT` (по умолчанию `0.0.0.0:3000`).

**PostgreSQL для телеоператора:** в репозитории есть [`docker-compose.yml`](docker-compose.yml) (пользователь `x402`, пароль `x402`, БД `x402raid`, порт хоста **5434**). Пример `DATABASE_URL`: `postgres://x402:x402@localhost:5434/x402raid`. Схема таблицы `teleoperators` создаётся при старте приложения (`CREATE TABLE IF NOT EXISTS`).

## Интерфейсы

| Путь | Назначение |
| --- | --- |
| `/` | Редирект на `/client` |
| `/client` | Публичный UI: настройки RPC, список роботов/команд, direct/raid, оплата и выполнение |
| `/ui` | Админка (статический UI): регистрация роботов, команды, карта — **требуется Basic Auth** (`ADMIN_USERNAME` / `ADMIN_PASSWORD`) |
| `/docs` | Swagger UI |
| `/docs-json` | Спецификация OpenAPI (JSON) |
| `/teleoperator` | UI телеоператора: регистрация, вход (только если задан `DATABASE_URL`) |
| `/teleoperator/cabinet` | Личный кабинет (нужна сессия; иначе редирект на логин). HTML отдаётся только с сервера, не из публичной статики |

## Конфигурация

Переменные окружения и флаги CLI описаны в `config/env.example`. Флаги вида `--port 3000` переопределяют env.

**Важно для Solana RPC:** провайдер задаётся `SOLANA_RPC_PROVIDER` (`helius` | `public` | `custom`) и при необходимости `HELIUS_API_KEY` или `X402_SOLANA_RPC_URL`. Публичный fallback в коде — не `mainnet-beta.solana.com` (частые 403); см. `buildSolanaRpcUrl` в `src/config.js`.

**Персистентные настройки клиента** (RPC с UI) пишутся в `config/client-settings.json` через `settingsStore`.

**Настройки AI-агента** (стратегия, URL n8n) можно сохранять из админки в `config/ai-agent.json` (также см. `AI_AGENT_STRATEGY`, `N8N_WEBHOOK_URL` в env).

### Админ-доступ

| Переменная | Описание | По умолчанию |
| --- | --- | --- |
| `ADMIN_USERNAME` | Basic Auth пользователь | `admin` |
| `ADMIN_PASSWORD` | Пароль (**смените в проде**) | `admin` |

Защищённые префиксы: статика `/ui` и API `/api/admin/*`.

### Телеоператор и база данных

| Переменная | Описание |
| --- | --- |
| `DATABASE_URL` | URI подключения PostgreSQL. Без неё телеоператор отключён. |
| `TELEOPERATOR_JWT_SECRET` | Секрет подписи JWT (**обязателен**, если задан `DATABASE_URL`). В dev при отсутствии env используется небезопасный дефолт (см. `src/config.js`); в `NODE_ENV=production` без секрета процесс не стартует. |
| `TELEOPERATOR_JWT_EXPIRES_IN` | Срок JWT (например `7d`, `24h`). По умолчанию `7d`. |
| `TELEOPERATOR_BCRYPT_ROUNDS` | Стоимость bcrypt (по умолчанию `10`). |

## API (кратко)

### Сервис и роботы

| Метод | Путь | Описание |
| --- | --- | --- |
| `GET` | `/health` | Статус сервиса, число роботов, флаг x402 |
| `GET` / `POST` | `/api/robots` | Список / регистрация |
| `PUT` / `DELETE` | `/api/robots/{id}` | Обновление / удаление |
| `POST` | `/api/robots/{id}/refresh` | Принудительный health-check |

### Команды (сервер как x402-клиент к роботам)

| Метод | Путь | Описание |
| --- | --- | --- |
| `POST` | `/api/commands/dance` | `quantity`: `1`, `2` или `"all"`; x402 по необходимости |
| `POST` | `/api/commands/buy-cola` | `location`, `quantity` |

### Клиентский API (без админ-авторизации; для `/client` и внешних клиентов)

| Метод | Путь | Описание |
| --- | --- | --- |
| `GET` / `POST` | `/api/client/settings` | Чтение / сохранение RPC-настроек (ключ Helius в ответе не отдаётся) |
| `GET` | `/api/client/robots` | Готовые роботы для direct-режима |
| `GET` | `/api/client/commands` | Агрегат команд по реестру |
| `POST` | `/api/client/estimate` | Оценка цены: `mode` `direct` \| `raid`, `command`, опционально `robotId` |
| `POST` | `/api/client/invoice` | Прокси первого POST на робота → **200** или **402** (инвойс) |
| `POST` | `/api/client/execute` | После оплаты в кошельке: проверка tx, вызов робота с `X-X402-Reference` |

### Платежи и админ API

| Метод | Путь | Описание |
| --- | --- | --- |
| `POST` | `/api/payments/x402` | Пример callback с проверкой подписи (x402 middleware) |
| `GET` / `POST` | `/api/admin/ai-agent` | Чтение / сохранение конфига AI (Basic Auth) |
| `GET` / `POST` | `/api/admin/client-settings` | Просмотр / сохранение RPC с админки (Basic Auth) |

### Телеоператор (без Basic Auth; сессия по cookie `teleop_token`)

| Метод | Путь | Описание |
| --- | --- | --- |
| `POST` | `/api/teleoperator/register` | Тело: `login`, `password`, `walletPublicKey` (Solana). Ответ 201, выставляется cookie. |
| `POST` | `/api/teleoperator/login` | `login`, `password`; cookie. |
| `POST` | `/api/teleoperator/logout` | Сброс cookie. |
| `GET` | `/api/teleoperator/me` | Профиль текущего пользователя (нужна валидная сессия). |

Полная схема запросов/ответов — в **Swagger** (`/docs`). Детали протокола x402 в приложении — [docs/X402_PROTOCOL.md](docs/X402_PROTOCOL.md).

## Ожидания от роботов

- `GET /health` или `/helth` → `{ status, message?, availableMethods?, location? }`.
- `POST /commands/dance`, `POST /commands/buy-cola` с телами согласно команде.
- Для платных эндпоинтов — ответ **402** в формате V2 (`accepts[0].extra.reference`, `payTo`, `amount`, `asset`).

Пример объекта в `availableMethods` см. в предыдущих версиях README или в `swagger.js` (`RobotHealthStatus`).

## Скрипты

```bash
npm run start
npm run dev
npm test
```

Тесты телеоператора и репозитория требуют **`TEST_DATABASE_URL`** (PostgreSQL). Если переменная не задана, соответствующие наборы помечаются как пропущенные и `npm test` завершается успешно. Пример:

```bash
export TEST_DATABASE_URL=postgres://x402:x402@127.0.0.1:5434/x402raid
docker compose up -d
npm test
```

## Расширение

- Новые команды: `src/services/commandRouter.js`, маршруты в `src/routes/commands.js`, **обновить Swagger** (`@openapi` + при необходимости `components.schemas` в `src/docs/swagger.js`).
- Смена стратегий без кода: `COMMAND_DANCE_STRATEGY`, `COMMAND_BUY_COLA_STRATEGY`, `PRICING_MARKUP_PERCENT`.
- Продакшен: защита публичного API ключами/аутентификацией, смена `ADMIN_PASSWORD`, персистентный реестр вместо памяти.

## Документация для разработчиков и ИИ-агентов

- [AGENTS.md](AGENTS.md) — правила контрибуции для автоматизированных ассистентов (README, Swagger, тесты, коммиты).

## Прочее

- Логи — структурированные строки (`src/utils/logger.js`).
- Ошибки Express проходят через общий handler в `src/index.js`.

Внешняя справка по x402: [x402 Register Resource](https://www.x402scan.com/resources/register).
