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
```

Integration tests require `TEST_DATABASE_URL` to point to a separate database whose name ends in `_test`. They refuse to run against another database. `npm run db:test:migrate` applies the schema using that test URL and also refuses a database name without the `_test` suffix; never point it at the development database.

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

The frontend development origin is `http://localhost:5173` by default and is allowed by the backend CORS configuration. Call the backend at `http://localhost:5001`, retain the login `accessToken`, and send it as a bearer token on protected requests. The current frontend is a starter screen and does not yet call these endpoints.

## Current limitations

- The outbox table is defined, but a background worker and retry processing are not implemented.
- Login rate limiting and refresh tokens are not implemented.
- There is no user/team administration API or public registration.
- Integration tests require a separately configured PostgreSQL test database.
