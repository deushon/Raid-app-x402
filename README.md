# x402 Raid Control Service

Node.js (Express) сервис, который оркестрирует x402-платежи и вызовы роботов. Есть **публичный клиентский UI** (`/client`), **админ-панель** (`/ui`, Basic Auth), REST API для реестра роботов, высокоуровневых команд и **клиентского потока** (оценка, инвойс 402, оплата в браузере, выполнение с заголовком **X-X402-Reference**).

## Возможности

- **x402 V2** при вызовах роботов: первый запрос → **402** с `accepts[]` → оплата (шлюз или прямой Solana) → повтор с заголовком **X-X402-Reference** (см. [docs/X402_PROTOCOL.md](docs/X402_PROTOCOL.md)).
- Провайдеры оплат: внешний x402 gateway или **solana-direct** (`@solana/web3.js`).
- Мониторинг здоровья роботов: опрос `/health` и legacy `/helth` (x402 при необходимости).
- Реестр роботов в памяти: статус, методы, координаты.
- **Command router**: `dance`, `buy-cola` с выбором исполнителя (цена, порядок, случайно / ближайший к точке).
- **Режим RAID для клиента**: выбор робота через **AIAgentService** (стратегии или webhook **n8n**), настраивается в админке.
- **ClientPaymentService**: проверка Solana-транзакции и задел под refund при сбое выполнения.
- **OpenAPI**: Swagger UI `/docs`, JSON `/docs-json` (см. `src/docs/swagger.js` и JSDoc `@openapi` в роутерах).
- **Телеоператор** (при настроенном `DATABASE_URL`): регистрация и вход (логин + пароль), в PostgreSQL хранится **bcrypt**-хеш пароля и **открытый** Solana `walletPublicKey`; сессия — **JWT** в httpOnly-cookie `teleop_token` и поле **`accessToken`** в JSON (для WebSocket и нативных клиентов). Личный кабинет `/teleoperator/cabinet`: открытые заявки «помощь», приём, **WebSocket URL** для прокси ROSBridge (см. ниже).
- **Телеоп-прокси (ROSBridge)**: робот и `raid_app` в **одной LAN**; сервер открывает исходящий WebSocket к `ws://rosbridgeHost:rosbridgePort` (по умолчанию тот же `host`, порт **9090**). В это подключение по умолчанию добавляются **идентификатор телеоператора**: заголовки **`X-Teleoperator-Id`** / **`X-Teleoperator-Login`** и query **`teleoperator_id`** / **`teleoperator_login`** (отключаются env **`TELEOP_FORWARD_OPERATOR_HEADERS`** / **`TELEOP_FORWARD_OPERATOR_QUERY`**). Оператор и VR-клиент подключаются только к **этому сервису** (`/ws/teleop/session/...`), без прямого доступа к rosbridge в интернет. Заявка **`POST /api/robots/{id}/teleop/help`** с заголовком **`X-Robot-Teleop-Secret`**; подключённые телеоператоры получают событие по **`/ws/teleoperator?token=JWT`**.

## Быстрый старт

### Требования

- Node.js 18+
- npm 9+
- Для защищённых роботов и серверных оплат: `X402_PRIVATE_KEY` (и при необходимости ключ для Solana).
- Для телеоператора и **телеоп-прокси**: **PostgreSQL** и переменные `DATABASE_URL`, `TELEOPERATOR_JWT_SECRET` (см. ниже). Без `DATABASE_URL` маршруты `/api/teleoperator/*`, **`/api/.../teleop/help`**, UI `/teleoperator` и WebSocket телеопа **не подключаются**.

### Установка и запуск

**Вариант A — всё в фоне (Docker, рекомендуется для сервера)**  
Поднимаются **PostgreSQL** и **Node-приложение** с политикой `**restart: unless-stopped`** (после перезагрузки хоста контейнеры стартуют снова, при падении процесса — перезапуск).

```bash
cp config/env.example .env   # заполните ключи, TELEOPERATOR_JWT_SECRET, ADMIN_* и т.д.
docker compose up -d --build
```

- API и UI доступны **по сети с любой машины** (если firewall пускает): `**http://<IP-или-DNS-сервера>:3000`**. Порт на хосте: `APP_HOST_PORT` (по умолчанию 3000), публикация `**0.0.0.0**` (все интерфейсы).
- Внутри compose для приложения `**DATABASE_URL` задаётся автоматически** (хост `postgres`, порт `5432`); значение `DATABASE_URL` в `.env` для этого режима **переопределяется** сервисом `app`.
- Каталог `**config/`** смонтирован в контейнер: `client-settings.json`, `ai-agent.json` и т.п. сохраняются на диске хоста.
- Логи: `docker compose logs -f app`
- Остановка: `docker compose down`

Образ собирается из `[Dockerfile](Dockerfile)` в корне репозитория.

**Вариант B — только Postgres в Docker, приложение локально (`npm run start`)**

```bash
npm install
cp config/env.example .env
docker compose up -d postgres   # только БД
# в .env: DATABASE_URL=postgres://x402:x402@localhost:5434/x402raid
npm run start                # продакшен
npm run dev                  # nodemon
```

Сервер слушает `**HOST` / `PORT**`. По умолчанию `**HOST=0.0.0.0**` — это **не** «только localhost»: процесс принимает соединения на **всех сетевых интерфейсах** машины, и с другого компьютера нужно открывать `**http://<публичный-IP-или-DNS-сервера>:3000`** (порт см. `PORT` / `APP_HOST_PORT` в Docker). Примеры с `localhost` в документации — для проверки **с самого сервера**. Если задать `**HOST=127.0.0.1`**, по сети достучаться нельзя (в логе будет предупреждение).

**PostgreSQL (compose):** порт **5434** проброшен на `**127.0.0.1`** хоста (только доступ с этого сервера, не из интернета). Пользователь `x402`, пароль `x402`, БД `x402raid`. Для `npm run` на хосте: `DATABASE_URL=...localhost:5434...`. Контейнер `app` подключается к БД по внутреннему адресу `postgres:5432`. Схемы **`teleoperators`**, **`help_requests`**, **`teleop_sessions`** создаются при старте приложения.

**Вариант C — systemd без Docker (пример юнита)**  
Шаблон: `[deploy/x402-raid-app.service.example](deploy/x402-raid-app.service.example)` — скопируйте в `/etc/systemd/system/`, поправьте пути и `User=`, затем `sudo systemctl enable --now x402-raid-app`.

## Интерфейсы


| Путь                    | Назначение                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/`                     | Редирект на `/client`                                                                                                          |
| `/client`               | Публичный UI: настройки RPC, список роботов/команд, direct/raid, оплата и выполнение                                           |
| `/ui`                   | Админка (статический UI): регистрация роботов, команды, карта — **требуется Basic Auth** (`ADMIN_USERNAME` / `ADMIN_PASSWORD`) |
| `/docs`                 | Swagger UI                                                                                                                     |
| `/docs-json`            | Спецификация OpenAPI (JSON)                                                                                                    |
| `/teleoperator`         | UI телеоператора: регистрация, вход (только если задан `DATABASE_URL`)                                                         |
| `/teleoperator/cabinet` | Личный кабинет (нужна сессия; иначе редирект на логин). HTML отдаётся только с сервера, не из публичной статики                |
| `ws://…/ws/teleoperator?token=` | События для телеоператоров (новая заявка помощи). Тот же JWT, что `accessToken` / cookie. За HTTPS используйте **`wss://`** (reverse proxy). |
| `ws://…/ws/teleop/session/{sessionId}?token=` | Дуплексный прокси **как прямой ROSBridge** (те же JSON-сообщения `op` / `topic` / `msg`). `sessionId` выдаётся после **`POST …/help-requests/{id}/accept`**. |


## Конфигурация

Переменные окружения и флаги CLI описаны в `config/env.example`. Флаги вида `--port 3000` переопределяют env.

**Важно для Solana RPC:** провайдер задаётся `SOLANA_RPC_PROVIDER` (`helius` | `public` | `custom`) и при необходимости `HELIUS_API_KEY` или `X402_SOLANA_RPC_URL`. Публичный fallback в коде — не `mainnet-beta.solana.com` (частые 403); см. `buildSolanaRpcUrl` в `src/config.js`.

**Персистентные настройки клиента** (RPC с UI) пишутся в `config/client-settings.json` через `settingsStore`.

**Настройки AI-агента** (стратегия, URL n8n) можно сохранять из админки в `config/ai-agent.json` (также см. `AI_AGENT_STRATEGY`, `N8N_WEBHOOK_URL` в env).

### Админ-доступ


| Переменная       | Описание                     | По умолчанию |
| ---------------- | ---------------------------- | ------------ |
| `ADMIN_USERNAME` | Basic Auth пользователь      | `admin`      |
| `ADMIN_PASSWORD` | Пароль (**смените в проде**) | `admin`      |


Защищённые префиксы: статика `/ui` и API `/api/admin/`*.

### CORS и доступ из приложений

- Включён **CORS** с **`credentials: true`** и динамическим **`Origin`** (отражается запрошенный origin). Браузерные SPA/другой домен могут вызывать API с `fetch(..., { credentials: 'include' })` или с заголовком **`Authorization: Bearer`** и JWT из поля **`accessToken`** в ответе login/register.
- **Нативные** клиенты (iOS/Android/desktop) обычно **не используют CORS**; им достаточно обычного HTTP и заголовка **`Authorization: Bearer`**.
- После **`POST /api/teleoperator/login`** или **`register`** в JSON приходит **`accessToken`** (тот же JWT, что в cookie `teleop_token`). Для приложений сохраняйте токен и передавайте: `Authorization: Bearer <accessToken>` на **`GET /api/teleoperator/me`** и далее.

### Телеоператор и база данных


| Переменная                    | Описание                                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | URI подключения PostgreSQL. Без неё телеоператор отключён.                                                                                                                                                |
| `TELEOPERATOR_JWT_SECRET`     | Секрет подписи JWT (**обязателен**, если задан `DATABASE_URL`). В dev при отсутствии env используется небезопасный дефолт (см. `src/config.js`); в `NODE_ENV=production` без секрета процесс не стартует. |
| `TELEOPERATOR_JWT_EXPIRES_IN` | Срок JWT (например `7d`, `24h`). По умолчанию `7d`.                                                                                                                                                       |
| `TELEOPERATOR_BCRYPT_ROUNDS`  | Стоимость bcrypt (по умолчанию `10`).                                                                                                                                                                     |
| `TELEOPERATOR_COOKIE_SECURE`  | `auto` (по умолчанию), `always`, `never` — флаг **Secure** у cookie. В режиме **auto** cookie по HTTP получает `Secure: false`, по HTTPS (или за прокси с `X-Forwarded-Proto: https` и **`TRUST_PROXY`**) — `true`. |
| `TRUST_PROXY`                 | Если приложение за reverse proxy: `1` или число хопов; нужно для корректного **auto** Secure и `req.secure`.                                                                                               |
| `TELEOP_WS_ENABLED`           | `false` или `0` — отключить обработчик WebSocket телеопа (REST заявок остаётся при `DATABASE_URL`). По умолчанию включено.                                                                              |
| `TELEOP_MAX_MESSAGE_BYTES`    | Лимит размера кадра WS в байтах (по умолчанию 16 MiB).                                                                                                                                                     |
| `TELEOP_ROSBRIDGE_CONNECT_TIMEOUT_MS` | Таймаут подключения сервера к rosbridge на роботе (мс).                                                                                                                                            |
| `TELEOP_FORWARD_OPERATOR_HEADERS` | `true` / `false` (по умолчанию `true`; выключают также `0`, `false`, `no`, `off`). Исходящий WS **raid_app → rosbridge**: заголовки **`X-Teleoperator-Id`** и при наличии логина **`X-Teleoperator-Login`**. |
| `TELEOP_FORWARD_OPERATOR_QUERY`   | `true` / `false` (по умолчанию `true`). К URL подключения к rosbridge добавляются query **`teleoperator_id`** и при наличии логина **`teleoperator_login`**. Если rosbridge/прокси ломается на `?…`, поставьте `false`. |

Идентификатор в заголовках и в query — это **UUID пользователя телеоператора** из PostgreSQL (тот же смысл, что поле **`sub`** в JWT); **сам JWT на робот не отправляется**. Логика сборки URL и заголовков: `buildRosbridgeWebSocketTarget` в [`src/ws/teleopServer.js`](src/ws/teleopServer.js).

## API (кратко)

### Сервис и роботы


| Метод            | Путь                       | Описание                                 |
| ---------------- | -------------------------- | ---------------------------------------- |
| `GET`            | `/health`                  | Статус сервиса, число роботов, флаг x402, **`teleoperatorEnabled`**, **`teleopWs`** |
| `GET` / `POST`   | `/api/robots`              | Список / регистрация в **памяти процесса** (после перезапуска список пуст). В ответе сейчас есть **`teleopSecret`** (чувствительные данные; позже может быть скрыт). Тело регистрации: опционально `rosbridgeHost`, `rosbridgePort`, `teleopSecret`. **Примеры в Swagger** (`Robo-1`, фиксированный UUID) — только документация; живые данные — то, что вы зарегистрировали (например `test1`). |
| `PUT` / `DELETE` | `/api/robots/{id}`         | Обновление / удаление                    |
| `POST`           | `/api/robots/{id}/refresh` | Принудительный health-check              |


### Команды (сервер как x402-клиент к роботам)


| Метод  | Путь                     | Описание                                                |
| ------ | ------------------------ | ------------------------------------------------------- |
| `POST` | `/api/commands/dance`    | `quantity`: `1`, `2` или `"all"`; x402 по необходимости |
| `POST` | `/api/commands/buy-cola` | `location`, `quantity`                                  |


### Клиентский API (без админ-авторизации; для `/client` и внешних клиентов)


| Метод          | Путь                   | Описание                                                                |
| -------------- | ---------------------- | ----------------------------------------------------------------------- |
| `GET` / `POST` | `/api/client/settings` | Чтение / сохранение RPC-настроек (ключ Helius в ответе не отдаётся)     |
| `GET`          | `/api/client/robots`   | Готовые роботы для direct-режима                                        |
| `GET`          | `/api/client/commands` | Агрегат команд по реестру                                               |
| `POST`         | `/api/client/estimate` | Оценка цены: `mode` `direct` | `raid`, `command`, опционально `robotId` |
| `POST`         | `/api/client/invoice`  | Прокси первого POST на робота → **200** или **402** (инвойс)            |
| `POST`         | `/api/client/execute`  | После оплаты в кошельке: проверка tx, вызов робота с `X-X402-Reference` |


### Платежи и админ API


| Метод          | Путь                         | Описание                                              |
| -------------- | ---------------------------- | ----------------------------------------------------- |
| `POST`         | `/api/payments/x402`         | Пример callback с проверкой подписи (x402 middleware) |
| `GET` / `POST` | `/api/admin/ai-agent`        | Чтение / сохранение конфига AI (Basic Auth)           |
| `GET` / `POST` | `/api/admin/client-settings` | Просмотр / сохранение RPC с админки (Basic Auth)      |


### Телеоператор (без Basic Auth; сессия по cookie `teleop_token`)


| Метод  | Путь                         | Описание                                                                               |
| ------ | ---------------------------- | -------------------------------------------------------------------------------------- |
| `POST` | `/api/teleoperator/register` | Тело: `login`, `password`, `walletPublicKey` (Solana). Ответ 201: cookie + **`accessToken`**. |
| `POST` | `/api/teleoperator/login`    | `login`, `password`; cookie + **`accessToken`**.                                              |
| `POST` | `/api/teleoperator/logout`   | Сброс cookie.                                                                                 |
| `GET`  | `/api/teleoperator/me`       | Профиль: cookie **`teleop_token`** или заголовок **`Authorization: Bearer`** с JWT.         |
| `POST` | `/api/robots/{id}/teleop/help` | Робот запрашивает помощь (LAN): **`X-Robot-Teleop-Secret`**, опционально `{ message, metadata }`. Повтор при уже открытой заявке → **200** и `duplicate: true`. |
| `GET`  | `/api/teleoperator/help-requests` | Список открытых заявок (JWT).                                                          |
| `POST` | `/api/teleoperator/help-requests/{id}/accept` | Принять заявку → **`session.id`** для WebSocket прокси.                         |


### Teleop proxy — контракт для внешних клиентов (Unity / Quest / ROSBridge)

Правки в сторонних репозиториях не входят в этот сервис; ниже контракт для интеграции.

1. **Базовый URL** — тот же хост и порт, что у HTTP API (или **`wss://`** за reverse proxy с поддержкой `Upgrade`).
2. **JWT**: после `POST /api/teleoperator/login` или `register` сохраните **`accessToken`** (или используйте cookie `teleop_token` только для браузера).
3. **Поток**: `GET /api/teleoperator/help-requests` → `POST /api/teleoperator/help-requests/{id}/accept` → в ответе **`session.id`**.
4. **WebSocket (вместо `ws://<робот>:9090`)**:
   - `ws(s)://<host>:<port>/ws/teleop/session/<sessionId>?token=<URL-encoded JWT>`
   - После подключения передавайте **те же текстовые кадры JSON**, что при прямом ROSBridge WebSocket (например `op: subscribe`, `op: publish`).
5. **Что видит робот при активной сессии:** с хоста `raid_app` к `ws://rosbridgeHost:rosbridgePort` уходит **второй** WebSocket (сервер → rosbridge). В нём по умолчанию передаются **`X-Teleoperator-Id`** / **`X-Teleoperator-Login`** и query **`teleoperator_id`** / **`teleoperator_login`** — чтобы на стороне робота (nginx, обёртка, логирование) было известно, **какой оператор** ведёт сессию. Отключение: **`TELEOP_FORWARD_OPERATOR_HEADERS`**, **`TELEOP_FORWARD_OPERATOR_QUERY`**. Стандартный rosbridge эти поля может не интерпретировать.
6. Ограничение размера кадра — см. `TELEOP_MAX_MESSAGE_BYTES`. При обрыве операторского сокета сессия в БД завершается, повторный приём заявки — новая сессия.

HTTP-вызов с робота «запросить помощь» (без JWT оператора): [docs/TELEOP_FETCH.md](docs/TELEOP_FETCH.md).

Полная схема запросов/ответов — в **Swagger** (`/docs`). Детали протокола x402 в приложении — [docs/X402_PROTOCOL.md](docs/X402_PROTOCOL.md).

## Ожидания от роботов

- `GET /health` или `/helth` → `{ status, message?, availableMethods?, location? }`.
- `POST /commands/dance`, `POST /commands/buy-cola` с телами согласно команде.
- Для платных эндпоинтов — ответ **402** в формате V2 (`accepts[0].extra.reference`, `payTo`, `amount`, `asset`).
- Для телеопа: на роботе доступен **ROSBridge WebSocket** (часто порт **9090**) с той же LAN, откуда `raid_app` достучится до `rosbridgeHost` / `rosbridgePort`. Скрипт на роботе может вызывать **`POST /api/robots/{robotId}/teleop/help`** с секретом, заданным при регистрации робота в админке (подробнее: [docs/TELEOP_FETCH.md](docs/TELEOP_FETCH.md)). После принятия заявки оператором на исходящем соединении к rosbridge пробрасываются **id/login оператора** (см. таблицу `TELEOP_FORWARD_*` выше) — при необходимости обработайте их в прокси на роботе.

Пример объекта в `availableMethods` см. в предыдущих версиях README или в `swagger.js` (`RobotHealthStatus`).

## Скрипты

```bash
npm run start
npm run dev
npm test
```

Тесты телеоператора, **teleop help** и репозитория требуют `**TEST_DATABASE_URL**` (PostgreSQL). Если переменная не задана, соответствующие наборы помечаются как пропущенные и `npm test` завершается успешно. Пример:

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
- [docs/TELEOP_FETCH.md](docs/TELEOP_FETCH.md) — HTTP `teleop/help` с робота (`teleop_fetch`) и связь с WS/rosbridge.

## Прочее

- Логи — структурированные строки (`src/utils/logger.js`).
- Ошибки Express проходят через общий handler в `src/index.js`.

Внешняя справка по x402: [x402 Register Resource](https://www.x402scan.com/resources/register).