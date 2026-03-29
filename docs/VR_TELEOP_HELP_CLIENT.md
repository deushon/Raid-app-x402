# Teleop help: изменения для VR / Quest / Unity (операторский клиент)

Кратко: в заявке о помощи появился структурированный контекст и поле **`situation_report`**. URL, JWT и сценарий «список → accept → WebSocket» **не менялись**.

## Что поменялось

1. **Робот** при вызове **`POST /api/robots/{robotId}/teleop/help`** теперь (по контракту) шлёт тело вида:
   - **`message`** — строка (краткая метка).
   - **`metadata.task_id`**, **`metadata.error_context`** — строки (`error_context` может быть пустой).
   - **`metadata.situation_report`** — опционально, длинный UTF-8 текст: что робот делал, в каком состоянии, зачем нужен оператор.

2. **Сервер RAID** всегда нормализует заявку: в **`payload`** попадают **`message`** и **`metadata`** с тремя строковыми полями выше. Если робот не прислал `situation_report` или весь `metadata`, недостающие значения будут **пустыми строками** `""`.

3. **Длина `situation_report`** на сервере ограничена **65536 байтами** в кодировке UTF-8; хвост обрезается без ошибки для клиента.

## Что сделать в VR-клиенте

| Источник | Действие |
| --- | --- |
| **`GET /api/teleoperator/help-requests`** | Читать контекст из **`helpRequests[i].payload`**: показывать **`payload.message`**, **`payload.metadata.task_id`**, **`payload.metadata.error_context`**, при необходимости — **`payload.metadata.situation_report`** (основной текст для оператора). |
| **WebSocket** `…/ws/teleoperator?token=…`, событие **`help_request`** | То же: текст в **`data.payload`** (тот же объект, что в списке заявок). |
| **Отображение** | Считать **`situation_report`** обычным текстом (UTF-8). **Не** вставлять в UI как HTML без экранирования. |
| **Совместимость** | Старые заявки в БД могли иметь другую форму **`payload`**. Используйте безопасный доступ: например `payload?.metadata?.situation_report ?? ""`. |

## Без изменений

- Авторизация оператора (JWT / cookie).
- Пути **`POST /api/teleoperator/help-requests/{id}/accept`** и **`/ws/teleop/session/{sessionId}?token=`**.
- Правила **grants** (`teleoperator_robot_grants`) для видимости заявок.

## Справка по API

- OpenAPI: тег **Teleop**, схема **`RobotTeleopHelpRequest`**, **`POST /api/robots/{robotId}/teleop/help`**.
- Спецификация робота → HTTP: [RAID_APP_TELEOP_HELP_SPEC.md](../RAID_APP_TELEOP_HELP_SPEC.md).
