# Интеграция робота с `raid_app` (роль `teleop_fetch`)

Документ описывает **HTTP-вызов с робота** к Raid App (условное имя **`teleop_fetch`**: скрипт, ROS-нода, systemd и т.д.) и **что робот видит**, когда телеоператор уже принял заявку и идёт прокси к ROSBridge.

См. также: [README.md](../README.md) (таблица `TELEOP_*`, Docker, health), исходный код [`src/routes/teleopHelp.js`](../src/routes/teleopHelp.js), [`src/ws/teleopServer.js`](../src/ws/teleopServer.js).

---

## Что делает `teleop_fetch`

Обычно **одно действие**: сообщить `raid_app`, что робот просит помощь — это **`POST /api/robots/{robotId}/teleop/help`**.

Для этого вызова **не нужны** JWT телеоператора, cookie и WebSocket: ими пользуются оператор и VR **после** принятия заявки.

---

## Условия на стороне `raid_app`

Без них маршрут помощи **не смонтирован** (запрос к `/api/robots/.../teleop/help` не обработается как телеоп):

1. Заданы **`DATABASE_URL`** и **`TELEOPERATOR_JWT_SECRET`** — создаются таблицы, подключаются `/api/teleoperator/*`, **`/api/robots/.../teleop/help`**, UI `/teleoperator`.
2. Робот **зарегистрирован** в реестре (админка `/ui` или `POST /api/robots`).
3. В карточке робота задан **`teleopSecret`** (сейчас поле **`teleopSecret`** также приходит в **`GET /api/robots`**; не светите ответ в логах и публичных клиентах).

Проверка: **`GET /health`** — **`teleoperatorEnabled: true`**, если БД подключена; **`teleopWs: true`**, если ещё включён WebSocket-телеоп (`TELEOP_WS_ENABLED` не `false`/`0`).

---

## Контракт HTTP для `teleop_fetch`

| Параметр | Значение |
| --- | --- |
| **Метод** | `POST` |
| **URL** | `http(s)://<HOST>:<PORT>/api/robots/<robotId>/teleop/help` |
| **`robotId`** | UUID из ответа `POST /api/robots` при регистрации (не `host:port` робота). |
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

После **201/200** подписанные телеоператоры получают событие по **`/ws/teleoperator?token=…`** (их JWT). На роботе дополнительно ничего открывать для этого не нужно.

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

---

## Сеть и безопасность

- Робот и `raid_app` должны видеть друг друга по сети (часто **LAN** и для HTTP `teleop/help`, и для исходящего WS к rosbridge).
- Секрет `teleopSecret` не логируйте целиком.
- CORS разрешает **`X-Robot-Teleop-Secret`** для браузера; типичный `teleop_fetch` на роботе — **сервер-сервер**, CORS не используется.

---

## Нужно ли менять код `teleop_fetch`

Меняйте **только если** не соблюдён контракт **POST …/teleop/help** (URL, метод, заголовок секрета, UUID робота). Проброс **`teleoperator_*`** на робот настраивается **в Raid App** и в **прокси/rosbridge-стеке** на роботе; самому `teleop_fetch` из-за этого обычно **ничего не добавлять**.

---

## OpenAPI

Тег **Teleop**, путь **`POST /api/robots/{robotId}/teleop/help`** — интерактивно в **`/docs`**.
