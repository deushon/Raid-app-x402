# x402 Raid Control Service

Node.js (Express) сервис, который оркестрирует x402-платежи и вызовы роботов. Есть **публичный клиентский UI** (`/client`), **админ-панель** (`/ui`, Basic Auth), REST API для реестра роботов, высокоуровневых команд и **клиентского потока** (оценка, инвойс 402, оплата в браузере, выполнение с заголовком **X-X402-Reference**).

## Возможности

- **x402 V2** при вызовах роботов: первый запрос → **402** с `accepts[]` → оплата (шлюз или прямой Solana) → повтор с заголовком **X-X402-Reference** (см. [docs/X402_PROTOCOL.md](docs/X402_PROTOCOL.md)).
- Провайдеры оплат: внешний x402 gateway или **solana-direct** (`@solana/web3.js`).
- Мониторинг здоровья роботов: опрос `/health` и legacy `/helth` (x402 при необходимости).
- Реестр роботов: при **`DATABASE_URL`** записи хранятся в PostgreSQL (таблица **`robots`**) и поднимаются после перезапуска; **статус health** по-прежнему в памяти процесса и обновляется опросом робота. Без **`DATABASE_URL`** реестр только в RAM (как раньше).
- **Command router**: `dance`, `buy-cola` с выбором исполнителя (цена, порядок, случайно / ближайший к точке).
- **Режим RAID для клиента**: выбор робота через **AIAgentService** (стратегии или webhook **n8n**), настраивается в админке.
- **ClientPaymentService**: проверка Solana-транзакции и задел под refund при сбое выполнения.
- **OpenAPI**: Swagger UI `/docs`, JSON `/docs-json` (см. `src/docs/swagger.js` и JSDoc `@openapi` в роутерах).
- **Телеоператор** (при настроенном `DATABASE_URL`): регистрация и вход (логин + пароль), в PostgreSQL хранится **bcrypt**-хеш пароля и **открытый** Solana `walletPublicKey`; сессия — **JWT** в httpOnly-cookie `teleop_token` и поле **`accessToken`** в JSON (для WebSocket и нативных клиентов). Личный кабинет `/teleoperator/cabinet`: открытые заявки «помощь», приём, **WebSocket URL** для прокси ROSBridge (см. ниже).
- **Телеоп-прокси (ROSBridge)**: робот и `raid_app` в **одной LAN**; сервер открывает исходящий WebSocket к `ws://rosbridgeHost:rosbridgePort` (по умолчанию тот же `host`, порт **9090**). В это подключение по умолчанию добавляются **идентификатор телеоператора**: заголовки **`X-Teleoperator-Id`** / **`X-Teleoperator-Login`** и query **`teleoperator_id`** / **`teleoperator_login`** (отключаются env **`TELEOP_FORWARD_OPERATOR_HEADERS`** / **`TELEOP_FORWARD_OPERATOR_QUERY`**). Оператор и VR-клиент подключаются только к **этому сервису** (`/ws/teleop/session/...`), без прямого доступа к rosbridge в интернет. Заявка **`POST /api/robots/{id}/teleop/help`** с заголовком **`X-Robot-Teleop-Secret`**; событие **`help_request`** по **`/ws/teleoperator?token=JWT`** и строки в **`GET /api/teleoperator/help-requests`** получают **все** подключённые операторы только если у робота **нет** активных выдач в **`teleoperator_robot_grants`**. Если выдачи есть — уведомления и список заявок по этому роботу видят **только** операторы с grant (таблица **`teleoperator_robot_grants`**, UI **`/ui/teleop-access.html`**); принять заявку может тот же набор. Контекст заявки в **`payload`** (в т.ч. **`metadata.situation_report`**, опционально **`metadata.kyr_peaq_context`** для peaq). Опционально **peaq claim**: при **`PEAQ_ENABLED`** и настроенных RPC/DID см. [docs/RAID_APP_PEAQ_CLAIM_SPEC.md](docs/RAID_APP_PEAQ_CLAIM_SPEC.md), ответ help содержит **`id`** и при успехе **`peaq_claim`**, иначе опрос **`GET /api/robots/{id}/peaq/claim?helpRequestId=`**. См. также [docs/VR_TELEOP_HELP_CLIENT.md](docs/VR_TELEOP_HELP_CLIENT.md).
- **Прокси HTTP датасета (оператор → робот)**: при **`DATABASE_URL`** доступен префикс **`/api/teleop/robots/{robotId}/dataset/...`** — тот же JWT телеоператора и **те же правила grant**, что и для приёма заявки помощи. Запросы **stream**-ятся на HTTP датасета робота (по умолчанию **`host:9191`**, либо поля реестра **`datasetHttpHost`** / **`datasetHttpPort`**). Подробнее: [docs/RAID_APP_DATASET_PROXY_SPEC.md](docs/RAID_APP_DATASET_PROXY_SPEC.md).
- **Флот и mDNS**: **`ROBOT_FLEET_ENROLLMENT_SECRET`** для **`POST /api/robots/enroll`** (стабильный **`enrollmentKey`** на роботе); опционально **`MDNS_ENABLED`** / **`MDNS_HOSTNAME`** — сервис объявляется в LAN как **`<hostname>.local`** (см. `config/env.example`). Push allowlist на робот: **`RAID_TO_ROBOT_SECRET`** и [docs/ROBOT_OPERATOR_SYNC.md](docs/ROBOT_OPERATOR_SYNC.md).

## Быстрый старт

### Требования

- Node.js 18+
- npm 9+
- Для защищённых роботов и серверных оплат: `X402_PRIVATE_KEY` (и при необходимости ключ для Solana).
- Для телеоператора, **персистентного реестра роботов**, **телеоп-прокси** и **HTTP-прокси датасета** (`/api/teleop/...`): **PostgreSQL** и переменные `DATABASE_URL`, `TELEOPERATOR_JWT_SECRET` (см. ниже). Без `DATABASE_URL` маршруты `/api/teleoperator/*`, **`/api/.../teleop/help`**, **`/api/teleop/*`**, UI `/teleoperator` и WebSocket телеопа **не подключаются**, а роботы **не сохраняются** между перезапусками приложения.

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
- Данные **PostgreSQL** лежат в именованном томе **`x402_raid_pgdata`** (роботы, телеоператоры, заявки помощи переживают пересборку контейнеров). **Не используйте** `docker compose down -v`, если нужно сохранить пользователей и роботов — флаг **`-v` удалит том и все данные**. Обычная остановка: `docker compose down` без **`-v`**.
- **`docker compose up -d --build` и перезагрузка хоста сами по себе не очищают таблицы** — приложение при старте только создаёт/дополняет схему (`IF NOT EXISTS`), без `TRUNCATE`/`DROP` по боевым данным.
- Если роботы и операторы «внезапно» пропали, чаще всего: (1) когда‑то запускали **`docker compose down -v`** или **`docker volume prune`**; (2) на этой же машине гоняли **`npm test`** с **`TEST_DATABASE_URL`**, указывающим на **тот же Postgres**, что проброшен на **`localhost:5434`** — тесты делают **`TRUNCATE … CASCADE`** по таблицам телеопа и роботов; (3) каталог с репозиторием **переименовали или склонировали в другую папку** — у Docker Compose другое имя проекта → **новый пустой том** (см. `docker volume ls | grep x402`). На сервере **не храните** `TEST_DATABASE_URL` в `.env` и не экспортируйте её в shell профиле, если с того же хоста поднимается compose Postgres.
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

**PostgreSQL (compose):** порт **5434** проброшен на `**127.0.0.1`** хоста (только доступ с этого сервера, не из интернета). Пользователь `x402`, пароль `x402`, БД `x402raid`. Для `npm run` на хосте: `DATABASE_URL=...localhost:5434...`. Контейнер `app` подключается к БД по внутреннему адресу `postgres:5432`. При старте создаются таблицы **`teleoperators`**, **`robots`**, **`help_requests`** (в т.ч. колонка **`peaq_claim`** JSONB для телеоп peaq), **`teleop_sessions`**, **`teleoperator_robot_grants`** (ACL телеоператор↔робот).

**Вариант C — systemd без Docker (пример юнита)**  
Шаблон: `[deploy/x402-raid-app.service.example](deploy/x402-raid-app.service.example)` — скопируйте в `/etc/systemd/system/`, поправьте пути и `User=`, затем `sudo systemctl enable --now x402-raid-app`.

## Интерфейсы


| Путь                    | Назначение                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/`                     | Редирект на `/client`                                                                                                          |
| `/client`               | Публичный UI: настройки RPC, список роботов/команд, direct/raid, оплата и выполнение                                           |
| `/ui`                   | Админка: сессия через **`POST /api/admin/login`** (cookie) или редирект на `/ui/login.html`; API `/api/admin/*` — cookie **или** HTTP Basic (`ADMIN_USERNAME` / `ADMIN_PASSWORD`) |
| `/ui/teleop-access.html` | Список операторов и роботов, **grants** (кто может принять teleop на каком роботе), синхронизация allowlist на робот (см. [docs/ROBOT_OPERATOR_SYNC.md](docs/ROBOT_OPERATOR_SYNC.md)). В «Add grant» операторы берутся из БД: сначала нужна хотя бы одна регистрация на **`/teleoperator`**. |
| `/docs`                 | Swagger UI                                                                                                                     |
| `/docs-json`            | Спецификация OpenAPI (JSON)                                                                                                    |
| `/teleoperator`         | UI телеоператора: регистрация, вход (только если задан `DATABASE_URL`)                                                         |
| `/teleoperator/cabinet` | Личный кабинет (нужна сессия; иначе редирект на логин). HTML отдаётся только с сервера, не из публичной статики                |
| `ws://…/ws/teleoperator?token=` | События для телеоператоров (новая заявка помощи). При ACL на роботе — только у операторов с grant на этот робот. Тот же JWT, что `accessToken` / cookie. За HTTPS используйте **`wss://`** (reverse proxy). |
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


Защищённые префиксы: статика `/ui` (кроме логина и общих стилей) и API `/api/admin/*` после логина или Basic.

### CORS и доступ из приложений

- Включён **CORS** с **`credentials: true`** и динамическим **`Origin`** (отражается запрошенный origin). Браузерные SPA/другой домен могут вызывать API с `fetch(..., { credentials: 'include' })` или с заголовком **`Authorization: Bearer`** и JWT из поля **`accessToken`** в ответе login/register.
- **Нативные** клиенты (iOS/Android/desktop) обычно **не используют CORS**; им достаточно обычного HTTP и заголовка **`Authorization: Bearer`**.
- После **`POST /api/teleoperator/login`** или **`register`** в JSON приходит **`accessToken`** (тот же JWT, что в cookie `teleop_token`). Для приложений сохраняйте токен и передавайте: `Authorization: Bearer <accessToken>` на **`GET /api/teleoperator/me`** и далее.

### Телеоператор и база данных


| Переменная                    | Описание                                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | URI подключения PostgreSQL. Без неё телеоператор отключён, **роботы не персистятся**. Таблица **`robots`** создаётся автоматически при старте (как и схемы телеоператора).                                  |
| `TELEOPERATOR_JWT_SECRET`     | Секрет подписи JWT (**обязателен**, если задан `DATABASE_URL`). В dev при отсутствии env используется небезопасный дефолт (см. `src/config.js`); в `NODE_ENV=production` без секрета процесс не стартует. |
| `TELEOPERATOR_JWT_EXPIRES_IN` | Срок JWT (например `7d`, `24h`). По умолчанию `7d`.                                                                                                                                                       |
| `TELEOPERATOR_BCRYPT_ROUNDS`  | Стоимость bcrypt (по умолчанию `10`).                                                                                                                                                                     |
| `TELEOPERATOR_COOKIE_SECURE`  | `auto` (по умолчанию), `always`, `never` — флаг **Secure** у cookie. В режиме **auto** cookie по HTTP получает `Secure: false`, по HTTPS (или за прокси с `X-Forwarded-Proto: https` и **`TRUST_PROXY`**) — `true`. |
| `TRUST_PROXY`                 | Если приложение за reverse proxy: `1` или число хопов; нужно для корректного **auto** Secure и `req.secure`.                                                                                               |
| `TELEOP_WS_ENABLED`           | `false` или `0` — отключить обработчик WebSocket телеопа (REST заявок остаётся при `DATABASE_URL`). По умолчанию включено.                                                                              |
| `TELEOP_MAX_MESSAGE_BYTES`    | Лимит размера кадра WS в байтах (по умолчанию 16 MiB).                                                                                                                                                     |
| `TELEOP_ROSBRIDGE_CONNECT_TIMEOUT_MS` | Таймаут **одной** попытки открыть исходящий WS к rosbridge (мс).                                                                                                                                       |
| `TELEOP_ROSBRIDGE_CONNECT_ATTEMPTS`   | Сколько таких попыток подряд с паузой **`TELEOP_ROSBRIDGE_RECONNECT_DELAY_MS`** перед отказом (по умолчанию **3**).                                                                                      |
| `TELEOP_ROSBRIDGE_RECONNECT_DELAY_MS` | Пауза между попытками (мс), по умолчанию **2000**.                                                                                                                                                       |
| `TELEOP_ROSBRIDGE_DROP_RECONNECT_ATTEMPTS` | После **уже установленного** соединения с rosbridge, при обрыве: сколько раз сервер снова пройдёт полный цикл попыток (см. выше), пока клиентский WS к Raid ещё открыт (по умолчанию **3**). После исчерпания — **1011** клиенту. |
| `TELEOP_SESSION_END_GRACE_MS`         | После отключения оператора от `/ws/teleop/session/...` или после окончательного падения rosbridge: через столько **мс** закрыть строку в **`teleop_sessions`** (по умолчанию **120000**). Пока сессия в БД не закрыта, можно снова подключиться **с тем же `sessionId` и JWT**. **`0`** — закрывать сессию в БД сразу (старое поведение). |
| `TELEOP_FORWARD_OPERATOR_HEADERS` | `true` / `false` (по умолчанию `true`; выключают также `0`, `false`, `no`, `off`). Исходящий WS **raid_app → rosbridge**: заголовки **`X-Teleoperator-Id`** и при наличии логина **`X-Teleoperator-Login`**. |
| `TELEOP_FORWARD_OPERATOR_QUERY`   | `true` / `false` (по умолчанию `true`). К URL подключения к rosbridge добавляются query **`teleoperator_id`** и при наличии логина **`teleoperator_login`**. Если rosbridge/прокси ломается на `?…`, поставьте `false`. |
| `TELEOP_DATASET_PROXY_TIMEOUT_MS` | Таймаут **исходящего** HTTP к датасету на роботе при прокси **`/api/teleop/robots/.../dataset/...`** (мс, по умолчанию **300000**). |
| **`PEAQ_ENABLED`** | `true` / `1` / `yes` / `on` — включить выдачу **peaq claim** для телеоп help. По умолчанию в `config/env.example` для dev включено; в проде задайте явно. |
| **`PEAQ_HTTP_BASE_URL`** | HTTPS RPC (Agung dev). Если **`PEAQ_ENABLED=true`** и переменная пуста — используется **`https://peaq-agung.api.onfinality.io/public`**. |
| **`PEAQ_WSS_BASE_URL`** | WSS для **`sdk.did.read`**. Если **`PEAQ_ENABLED=true`** и пусто — **`wss://wss-async.agung.peaq.network`**. |
| **`PEAQ_MACHINE_DID_NAME`** | Имя machine DID на цепи. |
| **`PEAQ_MACHINE_EVM_ADDRESS`** | EVM-адрес, связанный с DID. |
| **`PEAQ_NETWORK`** | Метка сети в JSON claim (по умолчанию **`peaq-agung`**). |
| **`PEAQ_CLAIM_SYNC_TIMEOUT_MS`** | Мс: если **`did.read`** укладывается в этот интервал, **`peaq_claim`** может вернуться сразу в **POST …/teleop/help**; иначе клейм дописывается в фоне и забирается через **GET …/peaq/claim** (по умолчанию **2500**). |

**Peaq / Agung (сбои снаружи):** недоступность RPC Peaq, крана AGNG или SDK **не ломает** **POST …/teleop/help** — заявка создаётся. Если **`did.read`** падает, в БД сохраняется fallback-объект **`peaq_claim`** с **`raid_peaq_read_status: "failed"`** и **`raid_peaq_error`** (краткий текст), чтобы **GET …/peaq/claim** не зависал на бесконечном **404**. Робот может трактовать это как «валидного DID-документа нет». Подробнее: [docs/RAID_APP_PEAQ_CLAIM_SPEC.md](docs/RAID_APP_PEAQ_CLAIM_SPEC.md) §5.1.

**Онбординг machine DID на Agung (вручную, до интеграции в enroll робота):** скрипт [`scripts/peaqOnboardMachine.js`](scripts/peaqOnboardMachine.js). Нужен кошелёк с тестовым PEAQ на Agung на газ.

```bash
npm run peaq:onboard -- --dry-run
PEAQ_ONBOARD_EVM_PRIVATE_KEY=0x... npm run peaq:onboard
```

В stdout будут **`PEAQ_MACHINE_DID_NAME`** и **`PEAQ_MACHINE_EVM_ADDRESS`** — вставьте в `.env` RAID. Ключ **`PEAQ_ONBOARD_EVM_PRIVATE_KEY`** только для отправки транзакции; в runtime RAID для **`did.read`** ключ не нужен. Экспорт **`onboardPeaqMachine`** из скрипта можно позже вызывать из кода регистрации робота.

**Кран AGNG на docs.peaq.xyz («Failed to fetch» / CORS):** виджет шлёт **POST** на `dev-peaq-faucet-service.cisys.xyz`. Если origin Peaq не отвечает вовремя, Cloudflare отдаёт **524**; страница ошибки **без** заголовка `Access-Control-Allow-Origin`, и браузер показывает **CORS** — это побочный эффект, а не «ваш адрес неверный». Обход с той же машины (без CORS): [`scripts/peaqFaucetRequest.js`](scripts/peaqFaucetRequest.js) — таймаут по умолчанию **180 с**:

```bash
npm run peaq:faucet -- 0xYourEvmAddress
```

Если снова **524** или таймаут — бэкенд крана на стороне Peaq; имеет смысл написать в [Discord Peaq](https://discord.gg/peaqnetwork). Опционально: **`PEAQ_FAUCET_APIKEY`**, **`PEAQ_FAUCET_URL`**, **`PEAQ_FAUCET_TIMEOUT_MS`** (см. `config/env.example`).

Идентификатор в заголовках и в query — это **UUID пользователя телеоператора** из PostgreSQL (тот же смысл, что поле **`sub`** в JWT); **сам JWT на робот не отправляется**. Логика сборки URL и заголовков: `buildRosbridgeWebSocketTarget` в [`src/ws/teleopServer.js`](src/ws/teleopServer.js). Для HTTP-прокси датасета на робот дополнительно ставятся **`X-Forwarded-For`**, **`X-Forwarded-Proto`**, **`X-Teleoperator-Id`** (и при наличии **`X-Teleoperator-Login`**); см. [`src/services/teleopDatasetProxy.js`](src/services/teleopDatasetProxy.js).

### Роботы: секрет флота, mDNS, синхронизация allowlist

| Переменная | Описание |
| ---------- | -------- |
| **`ROBOT_FLEET_ENROLLMENT_SECRET`** | Общий секрет роботов: `Authorization: Bearer …` или **`X-Robot-Fleet-Secret`** на **`POST /api/robots/enroll`** и (вместе с админом) на изменение **`/api/robots/*`**. Без секрета enroll возвращает **503**. Неверный секрет: **401** с текстом **`Invalid or missing fleet credential`**. Если при enroll приходит только **`{"error":"Unauthorized"}`** при включённой БД — обновите приложение (исправлена путаница маршрутов с телеоператором). |
| **`RAID_TO_ROBOT_SECRET`** | Секрет для HTTP **POST** на **`operatorRegistryUrl`** робота (push списка id операторов); см. [docs/ROBOT_OPERATOR_SYNC.md](docs/ROBOT_OPERATOR_SYNC.md). |
| **`MDNS_ENABLED`** | `true` / `1` / `yes` / `on` — включить mDNS (UDP 5353, multicast). |
| **`MDNS_HOSTNAME`** | Имя экземпляра (по умолчанию `raid-app`); в LAN обычно доступно как **`<имя>.local`**. В логах при успехе: **`mDNS advertisement started`**; если вместо этого ошибка — объявление в LAN не работает. В Docker с **bridge** multicast часто не доходит до других хостов даже при успешном старте — тогда **host network** для сервиса `app` или доступ по IP. |

## API (кратко)

### Сервис и роботы


| Метод            | Путь                       | Описание                                 |
| ---------------- | -------------------------- | ---------------------------------------- |
| `GET`            | `/health`                  | Статус сервиса, число роботов, флаг x402, **`teleoperatorEnabled`**, **`teleopWs`** |
| `GET`            | `/api/robots`              | Публичный список роботов **без** `teleopSecret`. Персистентность как выше. |
| `POST`           | `/api/robots/enroll`       | Саморегистрация флота: **`ROBOT_FLEET_ENROLLMENT_SECRET`** (`Authorization: Bearer` или **`X-Robot-Fleet-Secret`**), тело с **`enrollmentKey`** (стабильный id устройства), `host`, `port`, опционально `teleopSecret`, `operatorRegistryUrl`, **`datasetHttpHost`**, **`datasetHttpPort`** (для прокси датасета; порт по умолчанию на стороне Raid — **9191**, если не задан). Идемпотентный upsert; в ответе есть `teleopSecret`. Ожидаемые ошибки: **503** (секрет флота не настроен), **401** с упоминанием **fleet credential** (секрет не совпал). |
| `POST`           | `/api/robots`              | Новая регистрация (новый UUID): тот же секрет флота **или** сессия админа. Полный ответ с `teleopSecret`. |
| `PUT` / `DELETE` | `/api/robots/{id}`         | Обновление / удаление — секрет флота **или** админ. |
| `POST`           | `/api/robots/{id}/refresh` | Health-check — секрет флота **или** админ. |
| `GET` / `POST`   | `/api/admin/robots`        | Список / создание робота с полными полями (включая `teleopSecret`); только **админ** (cookie или Basic). |
| `PUT` / `DELETE` | `/api/admin/robots/{id}`   | Обновление / удаление. |
| `POST`           | `/api/admin/robots/{id}/refresh` | Принудительный health-check. |


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
| `GET` / `POST` | `/api/admin/ai-agent`        | Чтение / сохранение конфига AI (сессия или Basic)      |
| `GET` / `POST` | `/api/admin/client-settings` | Просмотр / сохранение RPC (сессия или Basic)           |
| `GET`          | `/api/admin/teleoperators`   | Список телеоператоров (публичные поля), для UI grants  |
| `GET` / `POST` / `DELETE` | `/api/admin/teleoperator-grants` … | Выдачи оператор↔робот; **DELETE** `/api/admin/teleoperator-grants/{teleoperatorId}/{robotId}` — отзыв |
| `POST`         | `/api/admin/robots/{id}/sync-operator-allowlist` | HTTP push allowlist на `operatorRegistryUrl` робота ([docs/ROBOT_OPERATOR_SYNC.md](docs/ROBOT_OPERATOR_SYNC.md)) |


### Телеоператор (без Basic Auth; сессия по cookie `teleop_token`)


| Метод  | Путь                         | Описание                                                                               |
| ------ | ---------------------------- | -------------------------------------------------------------------------------------- |
| `POST` | `/api/teleoperator/register` | Тело: `login`, `password`, `walletPublicKey` (Solana). Ответ 201: cookie + **`accessToken`**. |
| `POST` | `/api/teleoperator/login`    | `login`, `password`; cookie + **`accessToken`**.                                              |
| `POST` | `/api/teleoperator/logout`   | Сброс cookie.                                                                                 |
| `GET`  | `/api/teleoperator/me`       | Профиль: cookie **`teleop_token`** или заголовок **`Authorization: Bearer`** с JWT.         |
| `POST` | `/api/robots/{id}/teleop/help` | Робот запрашивает помощь (LAN): **`X-Robot-Teleop-Secret`**, JSON с обязательным строковым **`message`** и объектом **`metadata`** (нормализуется: **`task_id`**, **`error_context`**, **`situation_report`** — строки, пустые если не прислали; опциональный длинный UTF-8 отчёт **`situation_report`** до ~64 KiB, лишнее обрезается; опциональный объект **`kyr_peaq_context`** до 64 KiB JSON, иначе **413**). Ответ: **`helpRequest`**, **`duplicate`**, топ-уровневый **`id`** (тот же UUID заявки), при настроенном Peaq — опционально **`peaq_claim`**. Без тела/`message` → **400**. Повтор при уже открытой заявке → **200** и `duplicate: true`. |
| `GET`  | `/api/robots/{id}/peaq/claim?helpRequestId=` | Тот же **`X-Robot-Teleop-Secret`**. Возвращает **`{ peaq_claim }`** или **404** `{ "error": "claim_not_ready" }` пока клейм не готов. **`helpRequestId`** — UUID из **`id`** / **`helpRequest.id`** ответа help. |
| `GET`  | `/api/teleoperator/help-requests` | Список открытых заявок (JWT).                                                          |
| `POST` | `/api/teleoperator/help-requests/{id}/accept` | Принять заявку → **`session.id`**. Если у робота есть **хотя бы одна** активная выдача в **`teleoperator_robot_grants`**, принять может только выданный оператор; иначе — любой вошедший (как раньше). |
| `*`    | `/api/teleop/robots/{robotId}/dataset/{path}` | **Прокси** на HTTP датасета робота (метод, путь после `dataset/` и query сохраняются). JWT телеоператора (**`Authorization: Bearer`** или cookie **`teleop_token`**). Те же **grants**, что для accept заявки. **502** / **504** при недоступности upstream. См. [docs/RAID_APP_DATASET_PROXY_SPEC.md](docs/RAID_APP_DATASET_PROXY_SPEC.md). |


### Teleop proxy — контракт для внешних клиентов (Unity / Quest / ROSBridge)

Правки в сторонних репозиториях не входят в этот сервис; ниже контракт для интеграции.

1. **Базовый URL** — тот же хост и порт, что у HTTP API (или **`wss://`** за reverse proxy с поддержкой `Upgrade`).
2. **JWT**: после `POST /api/teleoperator/login` или `register` сохраните **`accessToken`** (или используйте cookie `teleop_token` только для браузера).
3. **Поток**: `GET /api/teleoperator/help-requests` → `POST /api/teleoperator/help-requests/{id}/accept` → в ответе **`session.id`**. У каждой заявки **`payload`** содержит **`message`** и **`metadata`** (в т.ч. **`situation_report`** для VR/UI). Событие WS **`help_request`** передаёт тот же **`payload`** в **`data`**. Подробнее для клиентов Quest/Unity: [docs/VR_TELEOP_HELP_CLIENT.md](docs/VR_TELEOP_HELP_CLIENT.md).
4. **WebSocket (вместо `ws://<робот>:9090`)**:
   - `ws(s)://<host>:<port>/ws/teleop/session/<sessionId>?token=<URL-encoded JWT>`
   - После подключения передавайте **те же текстовые кадры JSON**, что при прямом ROSBridge WebSocket (например `op: subscribe`, `op: publish`).
5. **Что видит робот при активной сессии:** с хоста `raid_app` к `ws://rosbridgeHost:rosbridgePort` уходит **второй** WebSocket (сервер → rosbridge). В нём по умолчанию передаются **`X-Teleoperator-Id`** / **`X-Teleoperator-Login`** и query **`teleoperator_id`** / **`teleoperator_login`** — чтобы на стороне робота (nginx, обёртка, логирование) было известно, **какой оператор** ведёт сессию. Отключение: **`TELEOP_FORWARD_OPERATOR_HEADERS`**, **`TELEOP_FORWARD_OPERATOR_QUERY`**. Стандартный rosbridge эти поля может не интерпретировать.
6. Ограничение размера кадра — см. `TELEOP_MAX_MESSAGE_BYTES`. **Время жизни JWT оператора** задаётся **`TELEOPERATOR_JWT_EXPIRES_IN`** (например `7d`). **Строка сессии телеопа в БД** после обрыва WS остаётся активной на время **`TELEOP_SESSION_END_GRACE_MS`**, затем закрывается (можно снова открыть тот же URL с тем же `sessionId`, пока не истёк grace и JWT). Переподключение **raid_app → rosbridge** при кратковременных сбоях — см. **`TELEOP_ROSBRIDGE_*_ATTEMPTS`** и **`TELEOP_ROSBRIDGE_RECONNECT_DELAY_MS`**. Код **1011** / причина **`Rosbridge error`** чаще всего означает, что с хоста Raid не удаётся устойчиво держать WS к **`rosbridgeHost:rosbridgePort`** (сеть, rosbridge не запущен, прокси режет заголовки/query — попробуйте **`TELEOP_FORWARD_OPERATOR_*`**).
7. **Датасет по HTTP (Quest / веб без прямого доступа к LAN робота):** базовый URL **`https://<raid>/api/teleop/robots/<robotUuid>/dataset`** — далее те же пути, что на роботе (**`dataset_status`**, **`upload_dataset`**, **`dataset_download/...`**, …). Тот же JWT, что для help/WS; при ACL на роботе — только операторы с grant. Таймаут upstream: **`TELEOP_DATASET_PROXY_TIMEOUT_MS`**.

HTTP-вызов с робота «запросить помощь» (без JWT оператора): [docs/TELEOP_FETCH.md](docs/TELEOP_FETCH.md).

Полная схема запросов/ответов — в **Swagger** (`/docs`). Детали протокола x402 в приложении — [docs/X402_PROTOCOL.md](docs/X402_PROTOCOL.md).

## Ожидания от роботов

- `GET /health` или `/helth` → `{ status, message?, availableMethods?, location? }`.
- `POST /commands/dance`, `POST /commands/buy-cola` с телами согласно команде.
- Для платных эндпоинтов — ответ **402** в формате V2 (`accepts[0].extra.reference`, `payTo`, `amount`, `asset`).
- Для телеопа: на роботе доступен **ROSBridge WebSocket** (часто порт **9090**) с той же LAN, откуда `raid_app` достучится до `rosbridgeHost` / `rosbridgePort`. Скрипт на роботе может вызывать **`POST /api/robots/{robotId}/teleop/help`** с секретом, заданным при регистрации робота в админке (подробнее: [docs/TELEOP_FETCH.md](docs/TELEOP_FETCH.md)). После принятия заявки оператором на исходящем соединении к rosbridge пробрасываются **id/login оператора** (см. таблицу `TELEOP_FORWARD_*` выше) — при необходимости обработайте их в прокси на роботе.
- Для выгрузки датасета с операторского клиента: с той же LAN `raid_app` должен открывать TCP к **`datasetHttpHost` / `datasetHttpPort`** (по умолчанию **`host`** и **9191**). Оператор ходит только на Raid (**`/api/teleop/robots/{id}/dataset/...`**), не на робот напрямую из интернета.

Пример объекта в `availableMethods` см. в предыдущих версиях README или в `swagger.js` (`RobotHealthStatus`).

## Скрипты

```bash
npm run start
npm run dev
npm test
```

Приложение на хосте с Postgres только из compose (порт **5434** на localhost) использует в `.env`:

```bash
DATABASE_URL=postgres://x402:x402@localhost:5434/x402raid
```

Тесты **не читают** `DATABASE_URL`: интеграционные наборы смотрят только на **`TEST_DATABASE_URL`**. Если она не задана, эти тесты пропускаются и `npm test` всё равно успешен. Пример той же БД, что и в `config/env.example` (не подставляйте сюда продакшен-БД — тесты делают **`TRUNCATE`**):

```bash
export TEST_DATABASE_URL=postgres://x402:x402@localhost:5434/x402raid
docker compose up -d postgres   # или полный stack
npm test
```

## Расширение

- Новые команды: `src/services/commandRouter.js`, маршруты в `src/routes/commands.js`, **обновить Swagger** (`@openapi` + при необходимости `components.schemas` в `src/docs/swagger.js`).
- Смена стратегий без кода: `COMMAND_DANCE_STRATEGY`, `COMMAND_BUY_COLA_STRATEGY`, `PRICING_MARKUP_PERCENT`.
- Продакшен: защита публичного API ключами/аутентификацией, смена `ADMIN_PASSWORD`, персистентный реестр вместо памяти.

## Документация для разработчиков и ИИ-агентов

- [AGENTS.md](AGENTS.md) — правила контрибуции для автоматизированных ассистентов (README, Swagger, тесты, коммиты).
- [docs/TELEOP_FETCH.md](docs/TELEOP_FETCH.md) — HTTP `teleop/help` с робота (`teleop_fetch`) и связь с WS/rosbridge.
- [docs/VR_TELEOP_HELP_CLIENT.md](docs/VR_TELEOP_HELP_CLIENT.md) — поле **`payload.metadata.situation_report`** для VR/операторского UI (список заявок и WS).
- [docs/ROBOT_SIDE_AI_AGENT.md](docs/ROBOT_SIDE_AI_AGENT.md) — гайд для агента/разработчика **кода на роботе**: enroll, секреты, help, allowlist, rosbridge.

## Прочее

- Логи — структурированные строки (`src/utils/logger.js`).
- Ошибки Express проходят через общий handler в `src/index.js`.

Внешняя справка по x402: [x402 Register Resource](https://www.x402scan.com/resources/register).