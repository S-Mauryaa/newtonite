# Newtonite

Newtonite is a local work-management application with a React/Vite frontend, an Express/TypeScript API, PostgreSQL, and Prisma.

## Prerequisites

- Node.js 20 or newer and npm.
- Docker Compose.

## Environment setup

The database container reads `POSTGRES_PASSWORD` from a root `.env` file. Create or retain your private local file; do not replace an existing one:

```sh
test -f .env || printf 'POSTGRES_PASSWORD=replace_with_a_private_local_password\n' > .env
```

Create the backend environment file from its example if it does not already exist:

```sh
test -f backend/.env || cp backend/.env.example backend/.env
```

Set `DATABASE_URL` to the local `newtonite_ops` database using the same local database password, and set a private `JWT_SECRET` of at least 32 characters. Set `SEED_DEMO_PASSWORD` only if preparing a fresh local development database for the demo seed. The test URL must point to a separate database ending in `_test`; the supplied configuration uses `newtonite_ops_test`.

The frontend defaults to `http://localhost:5001/api`. Set `VITE_API_URL` in `frontend/.env` only if the backend uses another URL.

Login attempts are limited to 10 per client IP per 15 minutes by default. Set `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` and `LOGIN_RATE_LIMIT_WINDOW_MS` in `backend/.env` to change this; both values are validated at startup. The in-memory limit is per API process, so it is not shared when the service is scaled to multiple instances.

## Install dependencies and prepare databases

```sh
cd backend
npm install
npm run db:generate
npm run db:migrate
npm run db:test:migrate
```

To populate a fresh development database with demo accounts and work items, run `npm run db:seed` from `backend/` once. The seed upserts demo records; do not rerun it when you need to preserve local verification data. The test database is separate and is never seeded by this command.

## Start the application

Start PostgreSQL from the repository root:

```sh
docker compose up -d postgres
docker compose ps
```

In one terminal:

```sh
cd backend
npm run dev
```

This starts the API and its in-process outbox worker by default. `OUTBOX_WORKER_ENABLED=false` disables worker polling while leaving API writes/enqueueing enabled.

In another terminal:

```sh
cd frontend
npm install
npm run dev
```

The frontend is at `http://localhost:5173`; the API is at `http://localhost:5001/api`. Check API liveness at `/api/health` and database readiness at `/api/ready`.

## Tests and builds

Run frontend checks from `frontend/`:

```sh
npm test
npm run lint
npm run build
```

Run backend checks from `backend/`:

```sh
npm test
npm run typecheck
npm run build
npx prisma validate
npx prisma migrate status
npx prisma migrate status --config prisma.test.config.ts
```

Backend integration tests require `TEST_DATABASE_URL` to point to a separate database whose name ends in `_test`. They refuse to run against a database without that suffix.

See [backend/README.md](./backend/README.md) for API, authorization, workflow, outbox behavior, and development account details. See [ENGINEERING_DECISIONS.md](./ENGINEERING_DECISIONS.md) for architectural decisions. Frontend-specific setup is in [frontend/README.md](./frontend/README.md).
