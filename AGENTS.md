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
| [src/routes/admin.js](src/routes/admin.js)       | Админ API (Basic Auth): конфиг AI, RPC клиента                                   |
| [src/routes/teleoperator.js](src/routes/teleoperator.js) | API телеоператора: регистрация, вход, сессия JWT (cookie)                 |
| [src/middleware/auth.js](src/middleware/auth.js) | Basic Auth для `/ui` и `/api/admin`                                              |
| [src/middleware/teleopSession.js](src/middleware/teleopSession.js) | JWT/cookie сессия телеоператора                              |
| [src/db/ensureTeleoperatorSchema.js](src/db/ensureTeleoperatorSchema.js) | DDL таблицы `teleoperators` (PostgreSQL)                         |
| [src/services/teleoperatorRepository.js](src/services/teleoperatorRepository.js) | Пользователи телеоператора в БД (bcrypt, Solana pubkey)   |
| [src/docs/swagger.js](src/docs/swagger.js)       | База OpenAPI и общие схемы для JSDoc                                             |
| [src/services/](src/services/)                   | Реестр, health, команды, x402, платежи, выбор исполнителя, настройки             |


## Нельзя

- Оставлять [README.md](README.md) или OpenAPI **в рассинхроне** с кодом.
- Добавлять эндпоинты **только** в prose без `@openapi` и при необходимости без схем в `swagger.js`.
- Вливать правки логики **без** тестов и осмысленного сообщения коммита.

