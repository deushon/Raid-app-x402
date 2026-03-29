# Инструкция для агента/разработчика: код на стороне робота и взаимодействие с RAID App

Документ для ИИ-агента или человека, который **дописывает софт на роботе** (ROS-нода, `teleop_fetch`, systemd, nginx перед rosbridge и т.д.). Описано, **как сейчас устроен RAID App** и **какие контракты нужно соблюдать на роботе**. Исходники RAID: репозиторий `x402_raid_app` (ветка/деплой согласуйте с командой).

---

## 1. Роли и границы ответственности

| Компонент | Где выполняется | Задача |
| --- | --- | --- |
| **RAID App** | Сервер (Node.js) | Реестр роботов, флот-секрет, enroll, приём заявок teleop, JWT телеоператоров, прокси WS оператор ↔ rosbridge, таблица «кто может управлять каким роботом» (grants), опциональный HTTP push allowlist на робот. |
| **Робот** | Ваш код | HTTP-клиент к RAID (enroll, help), **локальное хранение** `robotId`, `teleopSecret`, флот-секрет; при необходимости — **HTTP-сервер allowlist** и/или **фильтрация входящих** соединений к rosbridge (9090). |

**Важно:** «взаимная авторизация» **не симметрична в транспорте**. Робот доказывает RAID **секретами на HTTP** (флот + per-robot `teleopSecret`). RAID **не подписывает** исходящий WebSocket к rosbridge отдельным секретом: к роботу приходит обычное WS-подключение с заголовками/query с UUID оператора. **Доверие к тому, что это «легитимный RAID»**, на стороне робота обеспечиваете **сами** (сеть, firewall, опционально отдельный порт только для IP RAID, проверка заголовков + allowlist).

---

## 2. Что прошить в конфиг робота (минимум)

Согласуйте с оператором флота значения из `.env` RAID (они не «генерируются роботом», их выдаёт команда RAID):

| Параметр на роботе | Соответствие на RAID | Назначение |
| --- | --- | --- |
| Базовый URL RAID | `http(s)://<host>:<port>` | Все вызовы к API. |
| **`ROBOT_FLEET_ENROLLMENT_SECRET`** (тот же текст) | `ROBOT_FLEET_ENROLLMENT_SECRET` в `.env` RAID | Только для **`POST /api/robots/enroll`** и при необходимости других мутаций `/api/robots` с флот-авторизацией. |
| **`enrollmentKey`** | Не хранится на RAID как «секрет»; стабильный id устройства | Идемпотентная регистрация: один ключ → один `robotId`. |
| **`robotId`** (UUID) | Поле `id` в ответе enroll | Сохранить на диск после первого успешного enroll; использовать в URL help. |
| **`teleopSecret`** | Поле `teleopSecret` в ответе enroll / админки | Для **`POST /api/robots/{robotId}/teleop/help`**. Публичный **`GET /api/robots`** этот секрет **не отдаёт**. |
| (опционально) URL для allowlist | То, что уйдёт в поле **`operatorRegistryUrl`** при enroll | Полный URL вашего `POST` на роботе; RAID вызовет его при sync (см. п. 7). |
| (опционально) **`RAID_TO_ROBOT_SECRET`** (тот же текст) | `RAID_TO_ROBOT_SECRET` в `.env` RAID | Проверка заголовка **`X-Raid-To-Robot-Secret`** на вашем HTTP handler allowlist. |

**Обнаружение хоста RAID:** если на сервере включены **`MDNS_ENABLED`** и **`MDNS_HOSTNAME`** (например `raid-app`), в LAN часто можно использовать **`http://raid-app.local:<PORT>`** вместо IP. В Docker mDNS с bridge-сетью часто ломается — уточняйте у команды деплоя.

---

## 3. Как общаться с RAID: порядок интеграции

### Шаг A — Enroll (саморегистрация)

1. **`POST {RAID_BASE}/api/robots/enroll`**
2. Заголовок: **`X-Robot-Fleet-Secret: <ROBOT_FLEET_ENROLLMENT_SECRET>`**  
   **или** **`Authorization: Bearer <ROBOT_FLEET_ENROLLMENT_SECRET>`**
3. Тело JSON (обязательно):
   - **`enrollmentKey`** — стабильная строка (серийник, MAC, ваш uuid в прошивке).
   - **`host`**, **`port`** — как **другие узлы LAN достучатся до HTTP/health робота** (не localhost, если RAID не на том же хосте).
   - Опционально: **`rosbridgeHost`**, **`rosbridgePort`** (по умолчанию порт **9090**), **`name`**, **`teleopSecret`** (если не передать — RAID сгенерирует), **`operatorRegistryUrl`** (полный URL вашего API allowlist).
4. Успех: **200**, тело — объект робота с **`id`**, **`teleopSecret`**, и т.д. Сохраните **`id`** → `robotId` и **`teleopSecret`** персистентно.
5. Повторный enroll с тем же **`enrollmentKey`** **обновляет** ту же запись (**тот же `id`**). Вызывайте при смене IP/порта или после ремонта.

Если на RAID **не задан** `ROBOT_FLEET_ENROLLMENT_SECRET`, enroll вернёт **503** — это конфигурация сервера, не баг робота.

Подробнее: [TELEOP_FETCH.md](./TELEOP_FETCH.md) (раздел про enroll).

### Шаг B — Запрос телеопа (help)

1. **`POST {RAID_BASE}/api/robots/{robotId}/teleop/help`**
2. Заголовок: **`X-Robot-Teleop-Secret: <teleopSecret>`** или **`Authorization: Bearer <teleopSecret>`**
3. Тело опционально: `{ "message": "…", "metadata": { … } }`
4. **201** — новая заявка; **200** + **`duplicate: true`** — заявка уже открыта (можно не спамить).

Операторы и VR **не ходят на робот** за этим шагом; они работают через RAID (JWT, WebSocket на RAID).

### Шаг C — Что происходит на rosbridge (после accept оператором)

Когда оператор в RAID принял заявку и подключился к прокси, **сервер RAID** открывает **исходящий** WebSocket к **`ws://rosbridgeHost:rosbridgePort`** (из карточки робота).

В это подключение RAID по умолчанию добавляет:

- Заголовки (если не отключено на RAID): **`X-Teleoperator-Id`**, **`X-Teleoperator-Login`**
- Query: **`teleoperator_id`**, **`teleoperator_login`**

**JWT оператора на робот не передаётся.** Идентификатор оператора для политик на роботе — **UUID из PostgreSQL RAID** (совпадает с `sub` в JWT оператора на стороне RAID).

Отключение проброса на стороне RAID: переменные **`TELEOP_FORWARD_OPERATOR_HEADERS`**, **`TELEOP_FORWARD_OPERATOR_QUERY`** (см. README RAID).

**Ваша задача на роботе:** если нужна «авторизация оператора в роботе», реализовать проверку **после** того, как соединение дошло до rosbridge (прокси, плагин, обёртка). Стандартный rosbridge часто **игнорирует** эти заголовки — типично ставят **nginx** или отдельный порт только для «доверенного» источника.

---

## 4. RAID → робот: push allowlist операторов (опционально)

Если при enroll вы передали **`operatorRegistryUrl`**, админ RAID может вызвать sync. Контракт **строго** описан в [ROBOT_OPERATOR_SYNC.md](./ROBOT_OPERATOR_SYNC.md):

- **POST** на **точный** URL (без дописывания путей на стороне RAID).
- Заголовок **`X-Raid-To-Robot-Secret`** = значение **`RAID_TO_ROBOT_SECRET`** из `.env` RAID (должно совпадать с тем, что вы проверяете на роботе).
- Тело: `{ "allowedTeleoperatorIds": ["uuid", …] }` — только операторы с **активным grant** для этого робота в RAID.

Если секрет или URL не настроены, RAID **не звонит** на робот (ответ sync: `skipped`).

---

## 5. ACL «кто может принять заявку» (логика на RAID)

В RAID есть таблица выдач оператор↔робот (**`teleoperator_robot_grants`**). Правило:

- Если у робота **нет ни одной** активной выдачи — **любой** залогиненный телеоператор может принять help (**как раньше**).
- Если есть **хотя бы одна** выдача — принять может **только** оператор из списка выданных.

UI для ручного управления: **`/ui/teleop-access.html`** на RAID (админская сессия).

На роботе это **не настраивается**; робот только публикует help. Согласованность с allowlist на роботе достигается тем, что админ **выдаёт grant в RAID** и **жмёт sync** (или вы синхронизируете списки своим процессом).

---

## 6. Полезные эндпоинты и проверки

| Запрос | Назначение |
| --- | --- |
| **`GET {RAID_BASE}/health`** | `teleoperatorEnabled`, `teleopWs` — понять, поднят ли teleop на RAID. |
| **`GET {RAID_BASE}/api/robots`** | Публичный список роботов **без** `teleopSecret` (отладка «наш ли робот в реестре» по `enrollmentKey` в админке, не по этому GET). |

OpenAPI: **`/docs`**, **`/docs-json`**.

---

## 7. Поведение агента при разработке (рекомендации)

1. **Не хардкодить секреты в репозиторий** — читать из env/файла прав доступа на роботе.
2. **Персистентность:** после enroll сохранять `robotId` и `teleopSecret`; при старте сервиса — либо читать с диска, либо повторный enroll с тем же `enrollmentKey` (получите те же данные при неизменной записи).
3. **Сеть:** RAID должен достучаться до `host:port` (health) и до `rosbridgeHost:rosbridgePort`; робот должен достучаться до RAID по HTTP(S).
4. **Таймауты и ретраи:** enroll и help делать с backoff; на **401** по help — не ретраить бесконечно (секрет или `robotId` неверны).
5. **Логи:** не печатать полные секреты и Bearer-токены.
6. **Тест без железа:** поднять RAID локально (docker compose), выставить секреты, вызвать enroll с `host` = IP машины робота в LAN или тестового стенда.

---

## 8. Карта исходников RAID (для чтения контракта)

| Тема | Файлы |
| --- | --- |
| Enroll и защита `/api/robots` | `src/routes/robots.js`, `src/middleware/robotFleetAuth.js` |
| Help | `src/routes/teleopHelp.js` |
| Прокси WS → rosbridge | `src/ws/teleopServer.js` (`buildRosbridgeWebSocketTarget`) |
| Реестр, enroll upsert | `src/services/robotRegistry.js`, `src/services/robotRepository.js` |
| Grants, accept | `src/routes/teleopHelp.js`, `src/services/teleoperatorRobotGrantRepository.js` |
| Push allowlist | `src/services/robotOperatorSync.js` |
| mDNS | `src/services/mdnsAdvertisement.js`, `src/config.js` (`mdns`) |

---

## 9. Связанные документы в этом репозитории

- [TELEOP_FETCH.md](./TELEOP_FETCH.md) — HTTP help и enroll с точки зрения робота.
- [ROBOT_OPERATOR_SYNC.md](./ROBOT_OPERATOR_SYNC.md) — контракт POST allowlist на робот.
- [README.md](../README.md) — переменные окружения, таблицы API, Docker.

Если поведение RAID расходится с этим документом, **источник истины — код и OpenAPI**; тогда обновите данный файл или README в репозитории RAID после согласования с командой.
