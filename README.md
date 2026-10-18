# Newtonite

Newtonite is a work-management application for creating, assigning, tracking, and resolving operational work items across teams. It uses a React/Vite frontend, an Express/TypeScript API, PostgreSQL, and Prisma. The application supports team-based authorization, workflow enforcement, concurrency control, activity history, dashboard metrics, and asynchronous outbox processing.

## Architecture Overview

Newtonite follows a modular monolith architecture.

- **Frontend:** React and Vite.
- **Backend:** Node.js, Express, and TypeScript.
- **Database:** PostgreSQL.
- **Data access:** Prisma with the PostgreSQL driver adapter.
- **Authentication:** JWT-based authentication.
- **Authorization:** Server-side, team-based roles and resource-level access checks.
- **Concurrency:** Atomic claims, optimistic locking, and idempotent creation requests.
- **Audit history:** Activity events are recorded transactionally with relevant work-item changes.
- **Background processing:** A PostgreSQL-backed transactional outbox with an in-process worker.

The frontend communicates with the backend through the API. The backend enforces authorization, workflow rules, and concurrency constraints. PostgreSQL stores application data, activity history, and outbox jobs.

## Prerequisites

- Node.js 20 or newer and npm.
- Docker Compose.
- Git.

## Environment Setup

### 1. Configure the root environment

The PostgreSQL container reads `POSTGRES_PASSWORD` from the root `.env` file.

Create the file only if it does not already exist:

```sh
test -f .env || printf 'POSTGRES_PASSWORD=replace_with_a_private_local_password\n' > .env
```

Replace the placeholder with a private local development password. Do not commit this file.

### 2. Configure the backend environment

Create `backend/.env` from the example if it does not already exist:

```sh
test -f backend/.env || cp backend/.env.example backend/.env
```

Configure the following values in `backend/.env`:

- `DATABASE_URL`: Connection string for the local `newtonite_ops` PostgreSQL database, using the same database password configured for the local PostgreSQL instance.
- `TEST_DATABASE_URL`: Connection string for a separate test database whose name ends in `_test`. The supplied configuration uses `newtonite_ops_test`.
- `JWT_SECRET`: A private, sufficiently strong secret of at least 32 characters.
- `SEED_DEMO_PASSWORD`: The password used when preparing demo accounts through the seed script, according to the seed implementation.

Keep private environment files out of Git. Never use real production credentials for local development.

**Important:** Changing `SEED_DEMO_PASSWORD` does not necessarily change passwords for demo accounts that already exist. Check the seed script's behavior before expecting an existing account's password to change.

### 3. Configure the frontend environment

The frontend defaults to:

```text
http://localhost:5001/api
```

Set `VITE_API_URL` in `frontend/.env` only if the backend uses a different API URL.

### 4. Login rate limiting

Login attempts are limited to 10 per client IP per 15 minutes by default.

The following backend environment variables can change these limits:

- `LOGIN_RATE_LIMIT_MAX_ATTEMPTS`
- `LOGIN_RATE_LIMIT_WINDOW_MS`

Both values are validated at startup. The current in-memory limiter is per API process and does not share counters across multiple backend instances.

## Install Dependencies and Prepare Databases

From the repository root, start PostgreSQL:

```sh
docker compose up -d postgres
docker compose ps
```

Then prepare the backend:

```sh
cd backend
npm install
npm run db:generate
npm run db:migrate
npm run db:test:migrate
```

### Seed Demo Data

To populate a fresh development database with demo accounts and work items, run:

```sh
npm run db:seed
```

Run this command from the `backend/` directory.

The seed script upserts demo records. Review its behavior before rerunning it against a database containing verification or presentation data.

The development seed command does not seed the separate test database.

For demo-account emails, roles, and password configuration, see [backend/README.md](./backend/README.md).

## Start the Application

Make sure PostgreSQL is running before starting the backend.

### Backend

Open a terminal:

```sh
cd backend
npm run dev
```

The API runs at:

```text
http://localhost:5001
```

The API starts its in-process outbox worker by default.

Set `OUTBOX_WORKER_ENABLED=false` in `backend/.env` to disable worker polling while leaving API writes and outbox event creation enabled.

### Frontend

Open a second terminal:

```sh
cd frontend
npm install
npm run dev
```

Open the application at:

```text
http://localhost:5173
```

### Health and Readiness Endpoints

- Liveness: `http://localhost:5001/api/health`
- Database readiness: `http://localhost:5001/api/ready`

The readiness endpoint should be used to verify that the backend can access its database.

## Running Tests and Builds

### Frontend

Run the following commands from `frontend/`:

```sh
npm test
npm run lint
npm run build
```

Frontend tests use Vitest and React Testing Library with mocked API responses. They verify frontend behavior but do not replace end-to-end testing against a running backend.

### Backend

Run the following commands from `backend/`:

```sh
npm test
npm run typecheck
npm run build
npx prisma validate
npx prisma migrate status
npx prisma migrate status --config prisma.test.config.ts
```

Backend integration tests require `TEST_DATABASE_URL` to point to a separate PostgreSQL test database whose name ends in `_test`.

The test suite refuses to run against a database whose name does not satisfy that requirement. Do not point the test configuration at your development database.

## Core Features

- JWT-based authentication.
- Team memberships with role-based authorization.
- Work-item creation, listing, details, and updates.
- Server-side search, filtering, and cursor pagination.
- Atomic work-item claiming.
- Optimistic concurrency checks for stale updates.
- Idempotent creation requests.
- Server-enforced workflow transitions and approval permissions.
- Transactional activity history and comments.
- Dashboard metrics for work requiring attention.
- Transactional outbox processing with retries and bounded attempts.
- Login rate limiting.

## Known Limitations

- User registration and team administration APIs are not implemented; development accounts are created through the seed script.
- The outbox worker processes internal domain events but does not currently send external notifications.
- Outbox processing is at-least-once. Future handlers with external side effects must be idempotent.
- Failed outbox jobs require an operator procedure; a job-management or replay API is not implemented.
- Login rate-limit counters are stored in process memory and are not shared across backend instances.
- Frontend tests use mocked API responses and do not independently verify the entire application against a live backend.
- The application is designed for the assessment's scope and has not been established as production-hardened.

## Engineering Decisions

See [ENGINEERING_DECISIONS.md](./ENGINEERING_DECISIONS.md) for the reasoning behind the architecture, authorization, concurrency control, idempotency, transactional activity history, outbox processing, and login rate limiting.

For API endpoints, workflow rules, permissions, and development account details, see [backend/README.md](./backend/README.md).

For frontend-specific setup and testing, see [frontend/README.md](./frontend/README.md).