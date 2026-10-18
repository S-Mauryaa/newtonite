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

## 7. Use the transactional outbox for asynchronous domain events

Successful item creation, updates, claims, workflow transitions, and comments enqueue one domain event in the same PostgreSQL transaction as the mutation and its existing activity event. The outbox references activity event IDs rather than duplicating the activity history. Creation replays through the existing idempotency-key path do not enqueue another event.

An in-process worker starts with the API unless `OUTBOX_WORKER_ENABLED=false`. It claims due jobs in deterministic order inside a short transaction using `FOR UPDATE SKIP LOCKED`, then runs handlers outside the transaction so background work does not hold database locks or block HTTP handlers. Each job is acknowledged independently.

Jobs move through `PENDING`, `PROCESSING`, `COMPLETED`, and terminal `FAILED` states using the existing outbox columns. Attempts use bounded exponential backoff (1 second base, 60 second cap, 5 attempts by default). Handlers receive an abort signal and time out after 30 seconds by default; `updatedAt` acts as the processing lease timestamp, and stale `PROCESSING` jobs are requeued after 60 seconds or failed when attempts are exhausted. The stale interval must exceed the handler timeout. A stale worker's update is guarded by its claimed attempt count, so it cannot overwrite a newer attempt.

The current handler validates the supported event envelope and writes a safe operational log containing only the event ID and type. There is no external notification integration. Processing is at-least-once: a crash between handler execution and completion can cause a duplicate handler invocation. Future side-effecting consumers must be idempotent, such as by deduplicating on the outbox job ID. Terminal failure replay is an operator procedure and no management API exists yet.

## 8. Limit repeated login attempts

`POST /api/auth/login` uses an IP-keyed in-memory limiter with a 15-minute window and 10-attempt default. Both values are configurable and validated at startup. The route returns the regular JSON error envelope with HTTP 429 after the threshold; the response does not depend on whether the submitted email exists, and the window expires without permanently locking an account.

The limiter uses the standard Express rate-limit package and its process-local memory store, which fits the current single-process deployment without adding infrastructure. Counters are not shared between Node.js processes or servers, so horizontal scaling requires a shared store. The application does not enable proxy trust; deployments behind a reverse proxy must configure trusted proxy hops deliberately to ensure the limiter sees the real client IP without accepting spoofed forwarding headers.

## Trade-offs and limitations

- Prisma 7 uses the `@prisma/adapter-pg` driver adapter and an explicit generated-client output path.
- Memberships are reloaded for protected requests so role changes take effect without waiting for a token to expire; this adds one small database lookup per request.
- API tests use a separate PostgreSQL database and are intentionally guarded against a development database URL. They are not an in-memory substitute for PostgreSQL concurrency behavior.
- The outbox worker and login rate-limit state are in-process with the API; the limiter is not shared across multiple instances.
- Worker handlers are intentionally internal only; notifications, durable consumer receipts, and a failed-job replay interface remain future work.
