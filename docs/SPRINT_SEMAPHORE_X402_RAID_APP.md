# Сверка семафоров спринта с репозиторием **x402_raid_app**

**Дата:** 2026-03-31  
**Репозиторий:** Node.js + Express (`src/`), статика `public/`, PostgreSQL при `DATABASE_URL`.  
**Роль в продукте:** оркестратор RAID — x402, реестр роботов, телеоп-помощь, подпись SessionGrant для KYR, прокси ROSBridge/WebSocket, прокси HTTP датасета, опционально Peaq `did.read` для claim по заявке помощи.

Этот сервис **не** является полным «DATA node» с доменом инцидентов/записей спринта (`/api/v1/receipts`, `/api/v1/incidents`, `SessionRecord` как в спецификации KYR stats, recovery slices, HuggingFace и т.д.). Ниже — для каждого пункта указано, относится ли он к **этому** репо, и оценка по коду и тестам.

### Легенда статуса (для колонки «В репо»)

| Статус | Значение |
|--------|----------|
| **N/A** | Функциональность не входит в зону ответственности этого репозитория (другой сервис, ROS, VR, Ops/CEO). |
| **Частично** | Есть задел или смежная функция (документация, `task_id` в payload, Peaq claim JSON), но критерий спринта не выполнен целиком в этом коде. |
| **Да** | Логика реализована здесь; покрыта тестами там, где в `package.json` есть соответствующие файлы. |

### Проверка окружения (выполнено при подготовке документа)

- **`npm test`** — успешно (все непропущенные тесты пройдены). Часть интеграционных наборов пропускается без **`TEST_DATABASE_URL`** (см. README).
- **Продакшен-БД и логи** в документ не выгружались: подсчёт строк `help_requests` / внешних инцидентов не выполнялся (нет таблиц спринта под инциденты/receipts в этом сервисе). Для CEO-тестов (объёмы сессий, demo video) данные живут вне этого репо.

---

## Семафоры (deliverables 1–24)

| # | Deliverable | В репо | Комментарий |
|---|-------------|--------|-------------|
| 1 | Receipt emission (`receipts`, HMAC, `GET /api/v1/receipts/{id}`) | **N/A** | В репо нет таблицы `receipts` и путей `/api/v1/receipts`. Цепочка **SignedReceipt** описана для робота/KYR в [RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md](RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md), но HTTP API чеков спринта здесь не реализован. |
| 2 | Receipt–incident link | **N/A** | Нет `/api/v1/incidents`, нет связи receipt↔incident в БД. |
| 3 | Event↔recording (`dataset_id`, `critical_event_ids`) | **N/A** | Прокси датасета `GET/POST /api/teleop/robots/{id}/dataset/...` есть; поля инцидента/сессии спринта — в другом контуре. |
| 4 | TELEOP_TAKEOVER авто-детекция | **N/A** | ROS / кинематика; RAID не эмитит события TELEOP_TAKEOVER в API спринта. |
| 5 | Incident auto-generation | **N/A** | Нет сервиса инцидентов. |
| 6 | RTT preflight ≥200 мс | **N/A** | VR-клиент; в `raid_app` нет RTT-гейта перед сессией. |
| 7 | `raid_task_id` + `payment_id` в metadata.json / SessionRecord | **Частично** | В SessionGrant в поле **`task_id`** попадает строка из **`metadata.task_id`** заявки помощи (см. `teleopHelp.js` accept + `teleopSessionGrantService`). Отдельных колонок **`raid_task_id` / `payment_id`** в `teleop_sessions` нет; связь x402-платежа телеопа с записью сессии в этом репо не моделируется как в спринте. |
| 8 | KYR stats + UI (`total_recordings`, …) | **N/A** | Нет `GET /api/robots/{id}/stats` и KYR UI метрик. |
| 9 | Teleop-ready pose / TELEOP_READY | **N/A** | ROS / кинематика. |
| 10 | Bilateral control confirm | **N/A** | VR + ROS; в API нет `teleop_ready_at` / `operator_confirmed_at`. |
| 11 | Pre-connect briefing card | **N/A** | Карточка VR/Frontend; в RAID есть передача контекста в **`payload.metadata`** (`situation_report`, `task_id`, …) — см. [VR_TELEOP_HELP_CLIENT.md](VR_TELEOP_HELP_CLIENT.md), но не «брифинг-карточка» спринта. |
| 12 | Manual annotation baseline corpus | **N/A** | Ops / CEO / другой backend. |
| 13 | Cosmos Reason (`visual_annotation`, …) | **N/A** | Не реализовано. |
| 14 | Recovery slice extractor | **N/A** | Не реализовано. |
| 15 | Quality score v2 | **N/A** | Не реализовано. |
| 16 | HuggingFace publish pipeline | **N/A** | Не реализовано. |
| 17 | peaq ClaimRegistry, `claim_id` в SessionRecord/incidents | **Частично** | Реализованы **Peaq SDK `did.read`**, сохранение **`peaq_claim`** JSONB в **`help_requests`**, `GET /api/robots/{id}/peaq/claim`, fallback при ошибке чтения ([RAID_APP_PEAQ_CLAIM_SPEC.md](RAID_APP_PEAQ_CLAIM_SPEC.md)). Явного **`claim_id`** в схеме сессий/инцидентов нет; это не тот же контракт, что «ClaimRegistry real calls + claim_id в SessionRecord». |
| 18 | GR00T N1.6 validation report | **N/A** | ROS / Backend вне этого репо. |
| 19 | Annotation QA report | **N/A** | Не реализовано. |
| 20 | 500+ external incidents in DB | **N/A** | Нет таблицы внешних инцидентов. |
| 21 | CEO: сессии, task types, ground_truth, demo | **N/A** | Операционный/продуктовый трек; метрики не в этом API. |

---

## Тесты спринта (1–24) ↔ этот репозиторий

| # | Тест спринта | Оценка для **x402_raid_app** | Покрытие в репо |
|---|----------------|------------------------------|-----------------|
| 1 | Receipt emission | **N/A** — нет `GET /receipts` | — |
| 2 | Receipt–incident link | **N/A** | — |
| 3 | Event↔recording link | **N/A** | Прокси датасета тестируется в `test/teleop-dataset-proxy-http.test.js` (при `TEST_DATABASE_URL`). |
| 4 | TELEOP_TAKEOVER авто | **N/A** | — |
| 5 | Автогенерация инцидента | **N/A** | — |
| 6 | RTT preflight | **N/A** | — |
| 7 | `raid_task_id` / `payment_id` в session | **Частично / провал относительно критерия спринта** | `task_id` в подписанном гранте из `metadata.task_id` покрыт косвенно (`teleop-session-grant-service.test.js`, `teleop-help-http.test.js` с БД). **`payment_id` в записи сессии** — нет. |
| 8 | KYR stats API + UI | **N/A** | — |
| 9 | Safe handoff TELEOP_READY | **N/A** | — |
| 10 | Bilateral confirm timestamps | **N/A** | — |
| 11 | Pre-connect briefing card | **N/A** | Полезные данные для UI — нормализация help payload: `test/teleop-help-payload.test.js`. |
| 12 | Manual baseline corpus | **N/A** | — |
| 13 | Cosmos Reason | **N/A** | — |
| 14 | Recovery slice | **N/A** | — |
| 15 | Quality score v2 | **N/A** | — |
| 16–17 | HF publish | **N/A** | — |
| 18 | peaq ClaimRegistry + `claim_id` в session/incident | **Частично** | `test/peaq-claim-service.test.js` — fallback claim; HTTP/OpenAPI — `openapi-servers.test.js`, `teleop-help-http.test.js` (с БД). Нет поля **`claim_id`** в `teleop_sessions`. |
| 19 | Booster spike | **N/A** | Интеграция железа/конвейера вне узкого RAID API. |
| 20 | GR00T validation | **N/A** | — |
| 21 | Annotation QA | **N/A** | — |
| 22 | External incident DB | **N/A** | — |
| 23 | Session volume / stats | **N/A** | Нет `GET /api/v1/stats` в этом приложении. |
| 24 | Demo video | **N/A** | — |

---

## Что в этом репозитории сделано хорошо относительно смежных тем спринта

- **KYR × RAID:** подпись SessionGrant (Ed25519), выдача после accept, `teleopGrantPollUrl`, колонки `teleop_grant_payload` / `teleop_grant_signature`, публичный ключ в `/health` — см. [ROBOT_TELEOP_KYR_RAID_GRANT.md](ROBOT_TELEOP_KYR_RAID_GRANT.md), тесты `teleop-session-grant-service.test.js`, `teleop-help-http.test.js`.
- **Телеоп-пайплайн:** заявки, accept, сессии, WebSocket, grant по роботам, прокси датасета — тесты с `TEST_DATABASE_URL`.
- **Peaq:** опциональный claim и устойчивость к сбою `did.read` — `peaqClaimService`, спецификация и тесты.
- **Инвентаризация OpenAPI:** в репозитории добавлен тест `test/sprint-inventory-openapi.test.js` — фиксирует отсутствие путей спринта **`/api/v1/receipts*`**, **`/api/v1/incidents*`** и отсутствие **`GET …/robots/{robotId}/stats`** в собранной спецификации (чтобы при расширении API не путать границы сервисов).

---

## Рекомендация для handoff Sprint 2 → Sprint 3

Критерии из вашего блока «ТРЕБОВАНИЯ ДЛЯ ПЕРЕДАЧИ» (receipt chain, safe handoff, baseline corpus, recovery slices, GR00T validation, landings, WTP) **в основном не верифицируются только этим репозиторием**. Для честной зелёной сверки нужны:

1. Отдельный сервис/репозиторий с **`/api/v1/receipts`**, **`/api/v1/incidents`**, `SessionRecord`, stats — с собственными тестами и БД.  
2. ROS/VR репозитории — для TELEOP_TAKEOVER, RTT, TELEOP_READY, bilateral confirm, briefing UI.  
3. **x402_raid_app** подключать как **узел RAID** (гранты, телеоп, x402, при необходимости peaq claim), а не как единственный источник истины для семафоров 1–22.

---

## Сводка «светофор» только по границе **x402_raid_app**

| Категория | Итог |
|-----------|------|
| Полностью в зоне репо и близко к спринту | Подпись SessionGrant, телеоп help/accept/WS, прокси датасета, Peaq claim по help request. |
| Частичное пересечение | `task_id` в гранте из metadata; Peaq document без отдельного `claim_id` в сессии. |
| Вне репозитория | Receipts/incidents v1, события, RTT, UI карточки спринта, HF, quality score, external incidents, CEO-метрики, GR00T/annotation QA. |

Документ можно обновлять при появлении в этом репо новых маршрутов `/api/v1/*` или полей схемы — сверяйте с `npm test` и `/docs-json`.
