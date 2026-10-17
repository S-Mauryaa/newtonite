# Engineering decisions

## 1. Keep a small modular monolith

The existing service is a single Express application. Route modules, shared authorization/workflow services, validation, and one Prisma client keep the API understandable without creating service boundaries that the assessment does not need. This is easy to run locally and can be split later if a demonstrated scaling need appears.

## 2. Enforce team access at the API boundary

JWTs identify the caller only; middleware reloads current team memberships from PostgreSQL on each protected request. Read operations are constrained to those memberships, and resource operations first check the item's team. A non-member receives 404 for an item to avoid revealing that another team's record exists. Admin is scoped to memberships and never grants global access.

## 3. Claim work with a conditional write

Claiming uses `UPDATE ... WHERE id = ? AND assigneeId IS NULL AND status = OPEN` through Prisma `updateMany`. The affected-row count selects the one winner under concurrent requests. The item update and claim audit event are in the same transaction; losers get HTTP 409.

## 4. Use optimistic concurrency for edits

Work-item updates and transitions require the client-observed integer `version`. Each database update includes both item ID and version in its condition, and increments the version atomically. If no row matches, the request returns 409 without overwriting newer data.

## 5. Make creation idempotent within the transaction

An idempotency key is unique per authenticated user and operation. Its row, newly created item, creation event, and serialized response are committed in one transaction. Concurrent duplicate keys serialize on the unique constraint; after the winner commits, the loser returns the stored result. The request fingerprint rejects reuse with a changed payload.

## 6. Keep audit events transactional and durable

Creation, claim, field changes, transitions, and comments write audit events in the same transaction as their operation. A failed write rolls back its event. Foreign keys use restrictive deletion behavior so database-level deletes cannot silently erase audit history. The API does not offer item deletion.

## 7. Defer the worker until core behavior is stable

The schema includes an outbox model for future reliable background work, but this implementation does not enqueue or process jobs. A worker would need atomic job claiming, retry/backoff state, and idempotent handlers; claiming those features without implemented tests would overstate the system's guarantees.

## Trade-offs and limitations

- Prisma 7 uses the `@prisma/adapter-pg` driver adapter and an explicit generated-client output path.
- Memberships are reloaded for protected requests so role changes take effect without waiting for a token to expire; this adds one small database lookup per request.
- API tests use a separate PostgreSQL database and are intentionally guarded against a development database URL. They are not an in-memory substitute for PostgreSQL concurrency behavior.
- The current frontend remains a Vite starter and has not yet been connected to the API.
