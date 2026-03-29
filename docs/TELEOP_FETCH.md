# Интеграция робота с `raid_app` (роль `teleop_fetch`)

Документ описывает **HTTP-вызов с робота** к Raid App (условное имя **`teleop_fetch`**: скрипт, ROS-нода, systemd и т.д.) и **что робот видит**, когда телеоператор уже принял заявку и идёт прокси к ROSBridge.

См. также: [README.md](../README.md) (таблица `TELEOP_*`, Docker, health), [ROBOT_SIDE_AI_AGENT.md](./ROBOT_SIDE_AI_AGENT.md) (чеклист для кода на роботе), исходный код [`src/routes/teleopHelp.js`](../src/routes/teleopHelp.js), [`src/ws/teleopServer.js`](../src/ws/teleopServer.js).

---

## Что делает `teleop_fetch`

Обычно **одно действие**: сообщить `raid_app`, что робот просит помощь — это **`POST /api/robots/{robotId}/teleop/help`**.

Для этого вызова **не нужны** JWT телеоператора, cookie и WebSocket: ими пользуются оператор и VR **после** принятия заявки.

---

## Условия на стороне `raid_app`

Без них маршрут помощи **не смонтирован** (запрос к `/api/robots/.../teleop/help` не обработается как телеоп):

1. Заданы **`DATABASE_URL`** и **`TELEOPERATOR_JWT_SECRET`** — создаются таблицы, подключаются `/api/teleoperator/*`, **`/api/robots/.../teleop/help`**, UI `/teleoperator`.
2. Робот **зарегистрирован** в реестре: админка **`/ui`** (**`/api/admin/robots`**), либо **`POST /api/robots/enroll`** с **`ROBOT_FLEET_ENROLLMENT_SECRET`** (заголовок **`X-Robot-Fleet-Secret`** или **`Authorization: Bearer`**), либо **`POST /api/robots`** с тем же секретом или админ-сессией.
3. В карточке робота задан **`teleopSecret`** (ответ enroll/админского API; **публичный** **`GET /api/robots`** секрет **не** отдаёт).

Проверка: **`GET /health`** — **`teleoperatorEnabled: true`**, если БД подключена; **`teleopWs: true`**, если ещё включён WebSocket-телеоп (`TELEOP_WS_ENABLED` не `false`/`0`).

### Регистрация в реестре (`POST /api/robots/enroll`)

Рекомендуемый путь для робота: один раз (и при смене IP/host) вызвать **`POST /api/robots/enroll`** с тем же **`enrollmentKey`** (стабильный id устройства в вашем конфиге).

| Параметр | Значение |
| --- | --- |
| **URL** | `http(s)://<RAID_HOST>:<PORT>/api/robots/enroll` |
| **Авторизация флота** | **`X-Robot-Fleet-Secret: <ROBOT_FLEET_ENROLLMENT_SECRET>`** или **`Authorization: Bearer <тот же секрет>`** |
| **Тело (JSON)** | Обязательно **`enrollmentKey`**, **`host`**, **`port`**; опционально **`name`**, **`rosbridgeHost`**, **`rosbridgePort`**, **`teleopSecret`** (если не задать — сервер сгенерирует), **`operatorRegistryUrl`** (для push allowlist, см. [ROBOT_OPERATOR_SYNC.md](./ROBOT_OPERATOR_SYNC.md)) |

В ответе — полный объект робота, включая **`id`** (сохраните как **`robotId`**) и **`teleopSecret`**. Повторный вызов с тем же **`enrollmentKey`** обновляет строку (тот же **`id`**).

Обнаружение **`RAID_HOST`**: можно задать в конфиге **`http://raid-app.local:3000`** при включённом mDNS на сервере (**`MDNS_ENABLED`**, **`MDNS_HOSTNAME`**, см. README).

---

## Контракт HTTP для `teleop_fetch`

| Параметр | Значение |
| --- | --- |
| **Метод** | `POST` |
| **URL** | `http(s)://<HOST>:<PORT>/api/robots/<robotId>/teleop/help` |
| **`robotId`** | UUID из ответа **`POST /api/robots/enroll`** или админского **`POST /api/admin/robots`** (не `host:port` робота). |
| **Секрет робота** | Заголовок **`X-Robot-Teleop-Secret: <секрет>`** — тот же, что в реестре. **Или** **`Authorization: Bearer <секрет>`** (то же значение). |
| **Тело** | Необязательно: `{ "message": "…", "metadata": { … } }`. |
| **Content-Type** | При теле: `application/json`. |

### Ответы

| Код | Смысл |
| --- | --- |
| **201** | Новая заявка; в теле `helpRequest`, **`duplicate: false`**. |
| **200** | Уже есть открытая заявка для этого робота; тот же формат, **`duplicate: true`**. |
| **401** | Нет/неверный секрет или у робота не задан `teleopSecret`. |
| **404** | Нет такого `robotId` в реестре. |
| **500** | Ошибка сервера/БД. |

После **201/200** событие **`help_request`** уходит по **`/ws/teleoperator?token=…`**: если у робота есть активные строки в **`teleoperator_robot_grants`**, только этим операторам; иначе — всем подключённым с валидным JWT. На роботе дополнительно ничего открывать для этого не нужно.

### Пример (`curl`)

```bash
curl -sS -X POST \
  "http://RAID_HOST:3000/api/robots/ROBOT_UUID/teleop/help" \
  -H "Content-Type: application/json" \
  -H "X-Robot-Teleop-Secret: your-shared-secret" \
  -d '{"message":"Need assistance","metadata":{"battery":12}}'
```

### Требования к `teleopSecret`

В коде **нет** минимальной длины или ограничения по символам: пустая строка означает «телеоп выключен» для робота. Для продакшена используйте **длинный случайный** секрет, как для API-ключа.

---

## Идентификатор оператора на роботе (исходящий WS `raid_app` → rosbridge)

Это **не** часть `teleop_fetch`: срабатывает **после** того, как оператор вызвал **`POST /api/teleoperator/help-requests/{id}/accept`** и подключился к **`/ws/teleop/session/{sessionId}?token=…`**.

Тогда **сервер Raid App** открывает **свой** клиентский WebSocket к **`ws://rosbridgeHost:rosbridgePort`** (поля из карточки робота; по умолчанию `rosbridgeHost = host`, порт **9090**).

**JWT на робот не передаётся.** Передаются только **стабильные поля профиля**:

| Канал | Имя | Значение |
| --- | --- | --- |
| HTTP-заголовок | **`X-Teleoperator-Id`** | UUID пользователя телеоператора в PostgreSQL (= **`sub`** в JWT). |
| HTTP-заголовок | **`X-Teleoperator-Login`** | Логин из JWT, **только если** он есть при выдаче токена. |
| Query в URL | **`teleoperator_id`** | То же, что `X-Teleoperator-Id`. |
| Query в URL | **`teleoperator_login`** | То же, что логин; **параметр опускается**, если логина нет. |

Пример URL (без учёта путей rosbridge; фактически часто `ws://IP:9090?teleoperator_id=…&teleoperator_login=…`):

```text
ws://192.168.1.10:9090?teleoperator_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890&teleoperator_login=operator1
```

**Стандартный rosbridge** эти заголовки и query **может игнорировать**. Их обычно читают **nginx / другой прокси** перед rosbridge или собственная обёртка.

### Отключение проброса (только на стороне `raid_app`)

| Переменная | По умолчанию | Если `false` / `0` / `no` / `off` |
| --- | --- | --- |
| **`TELEOP_FORWARD_OPERATOR_HEADERS`** | включено | Не слать **`X-Teleoperator-*`**. |
| **`TELEOP_FORWARD_OPERATOR_QUERY`** | включено | Не добавлять **`teleoperator_*`** в URL. |

Пустые значения env оставляют **поведение по умолчанию** (включено). Реализация: **`buildRosbridgeWebSocketTarget`** в [`src/ws/teleopServer.js`](../src/ws/teleopServer.js), флаги в [`src/config.js`](../src/config.js) (`forwardOperatorHeaders` / `forwardOperatorQuery`).

**Переподключения и «жизнь» сессии WS** (тот же файл `teleopServer.js` + env в README): **`TELEOP_ROSBRIDGE_CONNECT_ATTEMPTS`**, **`TELEOP_ROSBRIDGE_RECONNECT_DELAY_MS`**, **`TELEOP_ROSBRIDGE_DROP_RECONNECT_ATTEMPTS`**, **`TELEOP_SESSION_END_GRACE_MS`**. JWT оператора по-прежнему **`TELEOPERATOR_JWT_EXPIRES_IN`**.

---

## Сеть и безопасность

- Робот и `raid_app` должны видеть друг друга по сети (часто **LAN** и для HTTP `teleop/help`, и для исходящего WS к rosbridge).
- Секрет `teleopSecret` не логируйте целиком.
- CORS разрешает **`X-Robot-Teleop-Secret`** и **`X-Robot-Fleet-Secret`** для браузера; типичный `teleop_fetch` на роботе — **сервер-сервер**, CORS не используется.

---

## Нужно ли менять код `teleop_fetch`

Меняйте **только если** не соблюдён контракт **POST …/teleop/help** (URL, метод, заголовок секрета, UUID робота). Проброс **`teleoperator_*`** на робот настраивается **в Raid App** и в **прокси/rosbridge-стеке** на роботе; самому `teleop_fetch` из-за этого обычно **ничего не добавлять**.

---

## OpenAPI

Тег **Teleop**, путь **`POST /api/robots/{robotId}/teleop/help`** — интерактивно в **`/docs`**.
