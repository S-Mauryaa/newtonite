import { Prisma, PrismaClient } from "../generated/prisma/client";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";

interface ClaimedOutboxJob {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
}

export interface OutboxWorkerOptions {
  pollIntervalMs?: number;
  batchSize?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  processingTimeoutMs?: number;
  staleProcessingMs?: number;
  now?: () => Date;
  handleJob?: (job: ClaimedOutboxJob, signal: AbortSignal) => Promise<void>;
  logError?: (message: string, error: unknown) => void;
}

const supportedEventTypes = new Set([
  "WORK_ITEM_CREATED",
  "WORK_ITEM_UPDATED",
  "WORK_ITEM_CLAIMED",
  "WORK_ITEM_STATUS_CHANGED",
  "WORK_ITEM_COMMENTED",
]);

function retryDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(attempt - 1, 30));
}

function safeErrorSummary(error: unknown): string {
  if (!(error instanceof Error)) return "Processing failed (unknown error)";
  const name = /^[A-Za-z0-9_-]{1,60}$/.test(error.name) ? error.name : "Error";
  return `Processing failed (${name})`;
}

async function handleDomainEvent(job: ClaimedOutboxJob): Promise<void> {
  if (!supportedEventTypes.has(job.type)) {
    throw new Error("Unsupported outbox event type");
  }
  if (
    typeof job.payload !== "object" ||
    job.payload === null ||
    Array.isArray(job.payload) ||
    typeof job.payload.workItemId !== "string" ||
    typeof job.payload.actorId !== "string" ||
    !Array.isArray(job.payload.activityEventIds) ||
    !job.payload.activityEventIds.every((id) => typeof id === "string")
  ) {
    throw new Error("Invalid outbox event payload");
  }

  console.info("Outbox domain event processed", {
    id: job.id,
    type: job.type,
  });
}

export class OutboxWorker {
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly processingTimeoutMs: number;
  private readonly staleProcessingMs: number;
  private readonly now: () => Date;
  private readonly handleJob: (job: ClaimedOutboxJob, signal: AbortSignal) => Promise<void>;
  private readonly logError: (message: string, error: unknown) => void;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private pollPromise: Promise<void> | null = null;
  private batchPromise: Promise<number> | null = null;

  constructor(
    private readonly database: PrismaClient = prisma,
    options: OutboxWorkerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? env.OUTBOX_POLL_INTERVAL_MS;
    this.batchSize = options.batchSize ?? env.OUTBOX_BATCH_SIZE;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? env.OUTBOX_RETRY_BASE_DELAY_MS;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? env.OUTBOX_RETRY_MAX_DELAY_MS;
    this.processingTimeoutMs = options.processingTimeoutMs ?? env.OUTBOX_PROCESSING_TIMEOUT_MS;
    this.staleProcessingMs = options.staleProcessingMs ?? env.OUTBOX_STALE_PROCESSING_MS;
    this.now = options.now ?? (() => new Date());
    this.handleJob = options.handleJob ?? handleDomainEvent;
    this.logError =
      options.logError ??
      ((message, error) =>
        console.error(message, {
          name: error instanceof Error ? error.name : "UnknownError",
        }));
    if (this.retryMaxDelayMs < this.retryBaseDelayMs) {
      throw new Error("Outbox retry maximum must be at least the retry base");
    }
    if (this.staleProcessingMs <= this.processingTimeoutMs) {
      throw new Error("Outbox stale-processing duration must exceed the processing timeout");
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.pollPromise;
    await this.batchPromise;
  }

  async runOnce(): Promise<number> {
    if (this.batchPromise) return this.batchPromise;
    this.batchPromise = this.processBatch().finally(() => {
      this.batchPromise = null;
    });
    return this.batchPromise;
  }

  private schedule(delay: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pollPromise = this.runOnce()
        .then(() => undefined)
        .catch((error: unknown) => {
          this.logError("Outbox polling failed", error);
        })
        .finally(() => {
          this.pollPromise = null;
          this.schedule(this.pollIntervalMs);
        });
    }, delay);
  }

  private async processBatch(): Promise<number> {
    const now = this.now();
    const jobs = await this.database.$transaction(async (transaction) => {
      const staleBefore = new Date(now.getTime() - this.staleProcessingMs);
      const staleJobs = await transaction.$queryRaw<
        Array<{ id: string; attempts: number; maxAttempts: number; updatedAt: Date }>
      >(Prisma.sql`
        SELECT "id", "attempts", "maxAttempts", "updatedAt"
        FROM "OutboxJob"
        WHERE "status" = 'PROCESSING'::"OutboxJobStatus"
          AND "updatedAt" <= ${staleBefore}
        ORDER BY "updatedAt" ASC, "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${this.batchSize}
      `);

      for (const staleJob of staleJobs) {
        const attempts = Math.max(1, staleJob.attempts);
        const exhausted = attempts >= staleJob.maxAttempts;
        await transaction.outboxJob.updateMany({
          where: {
            id: staleJob.id,
            status: "PROCESSING",
            attempts: staleJob.attempts,
            updatedAt: staleJob.updatedAt,
          },
          data: {
            status: exhausted ? "FAILED" : "PENDING",
            availableAt: new Date(
              now.getTime() +
                retryDelay(
                  attempts,
                  this.retryBaseDelayMs,
                  this.retryMaxDelayMs,
                ),
            ),
            lastError: "Processing lease expired before completion",
            updatedAt: now,
          },
        });
      }

      return transaction.$queryRaw<ClaimedOutboxJob[]>(Prisma.sql`
        WITH candidates AS (
          SELECT "id"
          FROM "OutboxJob"
          WHERE "status" = 'PENDING'::"OutboxJobStatus"
            AND "availableAt" <= ${now}
          ORDER BY "availableAt" ASC, "createdAt" ASC, "id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${this.batchSize}
        )
        UPDATE "OutboxJob" AS job
        SET "status" = 'PROCESSING'::"OutboxJobStatus",
            "attempts" = job."attempts" + 1,
            "updatedAt" = ${now}
        FROM candidates
        WHERE job."id" = candidates."id"
        RETURNING job."id", job."type", job."payload", job."attempts", job."maxAttempts"
      `);
    });

    for (const job of jobs) {
      try {
        const controller = new AbortController();
        let timeout: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            this.handleJob(job, controller.signal),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => {
                controller.abort();
                reject(new Error("Outbox handler timed out"));
              }, this.processingTimeoutMs);
            }),
          ]);
        } finally {
          if (timeout) clearTimeout(timeout);
        }
        const processedAt = this.now();
        await this.database.outboxJob.updateMany({
          where: { id: job.id, status: "PROCESSING", attempts: job.attempts },
          data: {
            status: "COMPLETED",
            processedAt,
            updatedAt: processedAt,
            lastError: null,
          },
        });
      } catch (error) {
        const exhausted = job.attempts >= job.maxAttempts;
        const failedAt = this.now();
        await this.database.outboxJob.updateMany({
          where: { id: job.id, status: "PROCESSING", attempts: job.attempts },
          data: {
            status: exhausted ? "FAILED" : "PENDING",
            availableAt: new Date(
              failedAt.getTime() +
                retryDelay(job.attempts, this.retryBaseDelayMs, this.retryMaxDelayMs),
            ),
            updatedAt: failedAt,
            lastError: safeErrorSummary(error),
          },
        });
      }
    }

    return jobs.length;
  }
}

export const outboxWorker = new OutboxWorker();
