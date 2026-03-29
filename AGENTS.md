# Инструкции для ИИ-агентов (x402 Raid App)

Этот файл дополняет [README.md](README.md) для людей. Здесь зафиксированы **обязательные** правила для любых правок в репозитории (в том числе от автоматизированных ассистентов).

## Область проекта

Стек: **Node.js + Express** в `src/`, статические UI в `public/`, примеры конфигурации в `config/`, описание протокола x402 в `docs/X402_PROTOCOL.md`.

## Обязательные практики при любых правках

### 1. Актуальный README для человека

- При **любой** функциональной правке (новые маршруты, переменные окружения, поведение, точки входа UI, значения по умолчанию) в том же наборе изменений нужно **обновить [README.md](README.md)**.
- Таблицы (URL, обзор API, конфигурация) должны соответствовать коду, чтобы человек мог запустить и эксплуатировать сервис без чтения diff.
- Если добавляете или переименовываете переменные окружения, синхронизируйте **README.md** и **config/env.example**.

### 2. Swagger / OpenAPI — часть контракта API

- Спецификация собирается через **swagger-jsdoc**: [src/docs/swagger.js](src/docs/swagger.js) + JSDoc-блоки `**@openapi`** в [src/index.js](src/index.js) и [src/routes/](src/routes/).
- При **добавлении, удалении или изменении** публичного HTTP-эндпоинта (путь, метод, тело, ответы, авторизация):
  - обновите или добавьте соответствующий блок `**@openapi`** у роутера (или в `index.js` для корневых маршрутов);
  - при необходимости дополните `**components.schemas**` в [src/docs/swagger.js](src/docs/swagger.js);
  - убедитесь, что новые файлы роутов попадают под `apis` в `swagger.js` (сейчас: `../routes/*.js`).
- После правок проверьте смысловую согласованность: **Swagger UI** `/docs` и **JSON** `/docs-json` отражают реальное поведение.

### 3. Тесты для всех затронутых участков кода

- **Не вносите изменения поведения без тестов**, которые покрывают затронутую логику (юнит или интеграция — по ситуации).
- Структура тестов должна соответствовать выбранному в [package.json](package.json) раннеру; пока в скрипте `test` заглушка — **при появлении первых реальных тестов добавьте раннер и рабочий `npm test`**.
- Покрывайте: новые обработчики маршрутов, ветки в сервисах (`commandRouter`, `x402Service`, `clientPaymentService`, `aiAgentService`, `settingsStore` и т.д.), изменения в `config.js`, если меняется поведение.

### 4. Коммиты

- Пишите **понятные сообщения коммитов** (повелительное наклонение, первая строка — суть изменения).
- По возможности один логический смысл на коммит; итог на ветке **не должен** оставлять устаревшими README, Swagger и тесты.

## Навигация по архитектуре


| Компонент                                        | Назначение                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| [src/index.js](src/index.js)                     | Сборка приложения, middleware, роутеры, `/health`, пример x402 callback, `/docs` |
| [src/config.js](src/config.js)                   | Env/CLI, `buildSolanaRpcUrl`                                                     |
| [src/routes/robots.js](src/routes/robots.js)     | API реестра роботов                                                              |
| [src/routes/commands.js](src/routes/commands.js) | `dance`, `buy-cola`                                                              |
| [src/routes/client.js](src/routes/client.js)     | Публичный клиентский API: настройки, estimate, invoice, execute                  |
| [src/routes/admin.js](src/routes/admin.js)       | Админ API: login/session, конфиг AI, RPC клиента (cookie или Basic)              |
| [src/routes/teleoperator.js](src/routes/teleoperator.js) | API телеоператора: регистрация, вход, сессия JWT (cookie)                 |
| [src/routes/teleopHelp.js](src/routes/teleopHelp.js) | Заявки помощи от робота, accept, broadcast в WS hub                        |
| [src/ws/teleopServer.js](src/ws/teleopServer.js) | Upgrade: `/ws/teleoperator`, `/ws/teleop/session/:id` → duplex к rosbridge   |
| [src/services/teleopHelpRepository.js](src/services/teleopHelpRepository.js) | PostgreSQL: `help_requests`, `teleop_sessions`                    |
| [src/services/teleopOperatorHub.js](src/services/teleopOperatorHub.js) | Рассылка JSON событий подключённым телеоператорам                    |
| [src/db/ensureTeleopHelpSchema.js](src/db/ensureTeleopHelpSchema.js) | DDL телеоп-таблиц                                                   |
| [src/db/ensureRobotSchema.js](src/db/ensureRobotSchema.js) | DDL таблицы **`robots`** (персистентный реестр при `DATABASE_URL`)        |
| [src/services/robotRepository.js](src/services/robotRepository.js) | Чтение/запись роботов в PostgreSQL                                |
| [src/middleware/adminAuth.js](src/middleware/adminAuth.js) | Сессия админки (cookie JWT), Basic опционально для `/api/admin` |
| [src/middleware/teleopSession.js](src/middleware/teleopSession.js) | JWT/cookie сессия телеоператора                              |
| [src/db/ensureTeleoperatorSchema.js](src/db/ensureTeleoperatorSchema.js) | DDL таблицы `teleoperators` (PostgreSQL)                         |
| [src/services/teleoperatorRepository.js](src/services/teleoperatorRepository.js) | Пользователи телеоператора в БД (bcrypt, Solana pubkey)   |
| [src/docs/swagger.js](src/docs/swagger.js)       | База OpenAPI и общие схемы для JSDoc                                             |
| [src/services/](src/services/)                   | Реестр, health, команды, x402, платежи, выбор исполнителя, настройки             |


## Нельзя

- Оставлять [README.md](README.md) или OpenAPI **в рассинхроне** с кодом.
- Добавлять эндпоинты **только** в prose без `@openapi` и при необходимости без схем в `swagger.js`.
- Вливать правки логики **без** тестов и осмысленного сообщения коммита.

### Данные PostgreSQL (телеоператоры, роботы, заявки, grants)

- **Никогда** не выполнять и не предлагать пользователю без его явного письменного запроса: **`DROP DATABASE`**, **`DROP TABLE`** (для боевых таблиц), **`TRUNCATE`** по `teleoperators`, `robots`, `help_requests`, `teleop_sessions`, `teleoperator_robot_grants`, а также удаление тома Docker с данными (**`docker compose down -v`**, ручное удаление тома **`x402_raid_pgdata`**).
- **Не** подключаться к рабочему **`DATABASE_URL`** пользователя командами, которые чистят данные; интеграционные тесты с `TRUNCATE`/`DROP` — только против **отдельной** тестовой БД (как **`TEST_DATABASE_URL`** в этом репозитории), никогда против compose/production Postgres пользователя.
- При отладке на машине пользователя: не сбрасывать БД «для чистоты эксперимента»; для проверок использовать копию, отдельный контейнер или явную просьбу человека.

