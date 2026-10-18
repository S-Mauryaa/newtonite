# Newtonite backend

Express 5, TypeScript, Prisma 7, and PostgreSQL API for team-scoped operational work items. The API provides JWT login, team membership authorization, versioned updates, workflow transitions, audit events, idempotent creation, comments, and dashboard counts.

## Prerequisites and local setup

- Node.js 20 or newer and npm.
- Docker Compose and the PostgreSQL service configured by `../docker-compose.yml`.

The root `.env` is used by Docker Compose and supplies `POSTGRES_PASSWORD`. The backend has its own `backend/.env`; do not copy the root file over it. Copy `.env.example` to `.env`, then use the same local database password configured in the root `.env` in `DATABASE_URL`. Set a private random `JWT_SECRET` of at least 32 characters. Set `SEED_DEMO_PASSWORD` to a local demo password of at least 12 characters before seeding.

```sh
test -f .env || cp .env.example .env
```

If `backend/.env` already exists, do not replace it; add or update the required variables in that file. `backend/.env` is ignored by Git. Never commit it or put real credentials in `.env.example`.

## Database and development server

From the repository root:

```sh
docker compose up -d postgres
docker compose ps
```

From `backend/`:

```sh
npm install
npm run db:generate
npm run db:migrate
npm run db:test:migrate
npm run db:seed
npm run dev
```

The example environment defaults the API to port 5001; the value in your existing `backend/.env` is preserved and overrides that default. `GET /api/health` is a liveness check; `GET /api/ready` also checks PostgreSQL connectivity.

`npm run dev` starts the API and, by default, its in-process transactional outbox worker. Set `OUTBOX_WORKER_ENABLED=false` to run the API without polling; domain events will still be enqueued and wait for a worker.

Login attempts are limited per client IP using the Express in-memory rate-limit store. Defaults are 10 attempts per 15 minutes. Configure `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` (1–100) and `LOGIN_RATE_LIMIT_WINDOW_MS` (1,000–86,400,000) in `backend/.env`; values are validated at startup. The `POST /api/auth/login` limit returns HTTP 429 with the standard API error envelope and applies the same response regardless of whether an email exists. The counter resets after the window; it does not lock accounts.

The counter is local to one Node.js process, not shared across processes or servers. This matches the current single-process local deployment; if the API is scaled across instances, each instance has its own limit and a shared store should be configured before relying on a fleet-wide threshold. The app does not trust proxy headers by default; when deployed behind a reverse proxy, configure Express proxy trust only for known proxy hops so clients cannot spoof the IP used for limiting.

## Commands

Run in `backend/`:

```sh
npm run db:generate
npm run db:migrate
npm run db:migrate:deploy
npm run db:seed
npm run db:studio
npm run typecheck
npm test
npm run build
npx prisma validate
npx prisma migrate status
```

Integration tests require `TEST_DATABASE_URL` to point to a separate database whose name ends in `_test`. They refuse to run against another database. `npm run db:test:migrate` applies the schema using that test URL and also refuses a database name without the `_test` suffix; never point it at the development database.

## Transactional outbox

Item creation, field updates, claims, workflow transitions, and comments create an `OutboxJob` in the same PostgreSQL transaction as the business change and its activity event. The outbox reuses the existing table; no new migration is required. The activity history remains the API-facing audit record, while the outbox contains one domain event per successful operation and references the corresponding activity event IDs.

The worker starts with the API unless `OUTBOX_WORKER_ENABLED=false`. It claims due jobs in creation/schedule order using `FOR UPDATE SKIP LOCKED`, processes each independently, and marks successful jobs `COMPLETED`. The current internal handler validates supported work-item event envelopes and logs only the event ID and type; it does not send email, webhooks, or messages.

Handler failures are retried with exponential delays starting at 1 second, doubling per attempt, and capped at 60 seconds by default. After 5 attempts a job becomes `FAILED`. Handlers are aborted after 30 seconds by default; an interrupted `PROCESSING` job is recovered after 60 seconds and scheduled for retry, or marked failed if its attempt limit was reached. The stale-processing interval must exceed the handler timeout. Error summaries store only the error class, not exception text, to avoid persisting secrets. Defaults can be tuned with `OUTBOX_POLL_INTERVAL_MS`, `OUTBOX_BATCH_SIZE`, `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_RETRY_BASE_DELAY_MS`, `OUTBOX_RETRY_MAX_DELAY_MS`, `OUTBOX_PROCESSING_TIMEOUT_MS`, and `OUTBOX_STALE_PROCESSING_MS`; retry maximum must be at least the retry base. Environment values are validated at startup.

Delivery is at least once: a process can fail after its handler runs but before completion is recorded, so a reclaimed job can be seen again. The current handler has no external side effect. Any future side-effecting handler must be idempotent (for example, by using the outbox job ID as its consumer idempotency key). Failed jobs are terminal and require an operator action; a management/replay API is not implemented.

Run the outbox integration and recovery tests with `npm test` from `backend/`. They use `TEST_DATABASE_URL` and the separately migrated `_test` database.

The repeatable seed creates three teams, ten local users, memberships, and ten representative work items. All demo users share `SEED_DEMO_PASSWORD`. Their local-only email addresses are:

- `alex@newtonite.local` (Operations admin)
- `jamie@newtonite.local` (Operations lead)
- `taylor@newtonite.local` (Operations member)
- `riley@newtonite.local` (Operations member)
- `casey@newtonite.local` (Operations viewer)
- `morgan@newtonite.local` (Customer Success lead)
- `jordan@newtonite.local` (Customer Success member)
- `avery@newtonite.local` (Customer Success member)
- `quinn@newtonite.local` (Finance admin)
- `sam@newtonite.local` (Finance member)

These accounts are for local development only; do not use their password in production.
The generated local demo password is stored in your ignored `backend/.env`; open that file locally to retrieve it, and do not paste it into chat or commit it. If you lose it, replace `SEED_DEMO_PASSWORD` locally with a new private password and rerun `npm run db:seed`; the seed upserts the demo users with fresh bcrypt hashes.

## API

Successful responses use `{ "data": ... }`; list endpoints include a `meta.nextCursor`. Errors use `{ "error": { "code": "...", "message": "..." } }`. Validation errors may include field details. Production errors do not include stack traces.

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | No | Liveness check |
| GET | `/api/ready` | No | Database readiness check |
| POST | `/api/auth/login` | No | Exchange email and password for a bearer JWT |
| GET | `/api/items` | Yes | Team-scoped filtered, searchable, cursor-paginated list |
| POST | `/api/items` | Yes | Create with an `Idempotency-Key` header |
| GET | `/api/items/:id` | Yes | Read an authorized item |
| PATCH | `/api/items/:id` | Yes | Edit fields with the current `version` |
| POST | `/api/items/:id/claim` | Yes | Atomically claim an open unassigned item |
| POST | `/api/items/:id/transition` | Yes | Apply a validated workflow transition with `version` |
| GET | `/api/items/:id/activity` | Yes | Read chronological audit events |
| GET | `/api/items/:id/comments` | Yes | Read comments |
| POST | `/api/items/:id/comments` | Yes | Add a comment |
| GET | `/api/dashboard` | Yes | Team-scoped workload counts |

For protected endpoints send `Authorization: Bearer <accessToken>`. Login accepts `{ "email": "...", "password": "..." }`. To create an item, send `title`, `type`, and `teamId`, optionally `description`, `priority`, `assigneeId`, and ISO `dueDate`; include a unique `Idempotency-Key`. To edit or transition, include the last observed integer `version`. On success, the item version increments; stale writes receive HTTP 409.

## Workflow and permissions

Allowed transitions:

- `OPEN` → `IN_PROGRESS`
- `IN_PROGRESS` → `OPEN` or `AWAITING_APPROVAL`
- `AWAITING_APPROVAL` → `IN_PROGRESS` or `RESOLVED`
- `RESOLVED` → `IN_PROGRESS` or `CLOSED`
- `CLOSED` → no further status

Only a team `LEAD` or `ADMIN` can approve `AWAITING_APPROVAL` → `RESOLVED`. Status is not editable through `PATCH`.

| Permission | VIEWER | MEMBER | LEAD | ADMIN |
| --- | --- | --- | --- | --- |
| Read own team's work items, activity, and comments | Yes | Yes | Yes | Yes |
| Create and edit work items | No | Yes | Yes | Yes |
| Claim open unassigned work items | No | Yes | Yes | Yes |
| Add comments | No | Yes | Yes | Yes |
| Make allowed non-approval transitions | No | Yes | Yes | Yes |
| Approve items awaiting approval | No | No | Yes | Yes |
| Access another team | No | No | No | No |

Non-members receive the same 404 response for a work item as for a missing item, avoiding cross-team resource disclosure.

## Connecting the frontend

The frontend development origin is `http://localhost:5173` by default and is allowed by the backend CORS configuration. The frontend in `../frontend` integrates with these endpoints through its authenticated API client. Set `VITE_API_URL` only when the backend URL differs from `http://localhost:5001/api`.

## Current limitations

- Refresh tokens are not implemented.
- There is no user/team administration API or public registration.
- Integration tests require a separately configured PostgreSQL test database.
