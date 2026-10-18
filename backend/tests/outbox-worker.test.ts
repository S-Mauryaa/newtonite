import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { OutboxWorker } from "../src/services/outbox-worker";

const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);
if (!databaseName.endsWith("_test")) {
  throw new Error("Outbox worker tests require a dedicated database whose name ends in _test");
}

const createdJobIds: string[] = [];

async function createJob(
  overrides: {
    status?: "PENDING" | "PROCESSING";
    attempts?: number;
    maxAttempts?: number;
    updatedAt?: Date;
  } = {},
) {
  const job = await prisma.outboxJob.create({
    data: {
      type: "WORK_ITEM_CREATED",
      payload: {
        workItemId: `worker-test-${randomUUID()}`,
        actorId: "worker-test-actor",
        activityEventIds: [],
      },
      status: overrides.status ?? "PENDING",
      attempts: overrides.attempts ?? 0,
      maxAttempts: overrides.maxAttempts ?? 5,
      availableAt: new Date(0),
      ...(overrides.updatedAt ? { updatedAt: overrides.updatedAt } : {}),
    },
  });
  createdJobIds.push(job.id);
  return job;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (createdJobIds.length) {
    await prisma.outboxJob.deleteMany({ where: { id: { in: createdJobIds } } });
    createdJobIds.length = 0;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("transactional outbox worker", () => {
  it("marks successful jobs completed", async () => {
    const job = await createJob();
    const handler = vi.fn(async () => undefined);
    const worker = new OutboxWorker(prisma, { handleJob: handler });

    expect(await worker.runOnce()).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "COMPLETED",
      attempts: 1,
      lastError: null,
    });
    expect((await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } })).processedAt)
      .toBeInstanceOf(Date);
  });

  it("validates and logs supported domain events without logging their payload", async () => {
    const job = await createJob();
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const worker = new OutboxWorker(prisma);

    await worker.runOnce();

    expect(log).toHaveBeenCalledWith("Outbox domain event processed", {
      id: job.id,
      type: "WORK_ITEM_CREATED",
    });
    expect(log.mock.calls[0]).not.toContainEqual(expect.objectContaining({
      workItemId: expect.any(String),
    }));
    expect((await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } })).status)
      .toBe("COMPLETED");
  });

  it("schedules bounded exponential retry delays", async () => {
    const job = await createJob();
    let currentTime = new Date();
    const worker = new OutboxWorker(prisma, {
      now: () => currentTime,
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 250,
      handleJob: async () => {
        throw new TypeError("sensitive details are not persisted");
      },
    });

    await worker.runOnce();
    let stored = await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe("PENDING");
    expect(stored.availableAt.getTime() - currentTime.getTime()).toBe(100);
    expect(stored.lastError).toBe("Processing failed (TypeError)");

    currentTime = new Date(currentTime.getTime() + 100);
    await prisma.outboxJob.update({
      where: { id: job.id },
      data: { availableAt: currentTime },
    });
    await worker.runOnce();
    stored = await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe("PENDING");
    expect(stored.availableAt.getTime() - currentTime.getTime()).toBe(200);

    currentTime = new Date(currentTime.getTime() + 200);
    await prisma.outboxJob.update({
      where: { id: job.id },
      data: { availableAt: currentTime },
    });
    await worker.runOnce();
    stored = await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.availableAt.getTime() - currentTime.getTime()).toBe(250);
  });

  it("stops retrying at the per-job attempt limit", async () => {
    const job = await createJob({ maxAttempts: 2 });
    const handler = vi.fn(async () => {
      throw new Error("failure");
    });
    let currentTime = new Date();
    const worker = new OutboxWorker(prisma, {
      now: () => currentTime,
      retryBaseDelayMs: 100,
      handleJob: handler,
    });

    await worker.runOnce();
    currentTime = new Date(currentTime.getTime() + 100);
    await prisma.outboxJob.update({
      where: { id: job.id },
      data: { availableAt: currentTime },
    });
    await worker.runOnce();
    expect(await worker.runOnce()).toBe(0);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "FAILED",
      attempts: 2,
    });
  });

  it("continues processing unrelated jobs after one handler fails", async () => {
    const failingJob = await createJob();
    const successfulJob = await createJob();
    const worker = new OutboxWorker(prisma, {
      batchSize: 2,
      handleJob: async ({ id }) => {
        if (id === failingJob.id) throw new Error("one job failed");
      },
    });

    expect(await worker.runOnce()).toBe(2);
    expect((await prisma.outboxJob.findUniqueOrThrow({ where: { id: failingJob.id } })).status)
      .toBe("PENDING");
    expect((await prisma.outboxJob.findUniqueOrThrow({ where: { id: successfulJob.id } })).status)
      .toBe("COMPLETED");
  });

  it("aborts handlers that exceed the configured processing timeout", async () => {
    const job = await createJob();
    const worker = new OutboxWorker(prisma, {
      processingTimeoutMs: 20,
      staleProcessingMs: 100,
      retryBaseDelayMs: 100,
      handleJob: async (_claimedJob, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    });

    await worker.runOnce();
    expect(await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "PENDING",
      attempts: 1,
      lastError: "Processing failed (Error)",
    });
  });

  it("uses SKIP LOCKED claims so separate workers do not process a job concurrently", async () => {
    const job = await createJob();
    let releaseHandler!: () => void;
    let markStarted!: () => void;
    const handlerStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const handler = vi.fn(async () => {
      markStarted();
      await handlerGate;
    });
    const firstWorker = new OutboxWorker(prisma, { handleJob: handler });
    const secondWorker = new OutboxWorker(prisma, { handleJob: handler });

    const firstRun = firstWorker.runOnce();
    await handlerStarted;
    expect(await secondWorker.runOnce()).toBe(0);
    releaseHandler();
    await firstRun;

    expect(handler).toHaveBeenCalledTimes(1);
    expect(await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "COMPLETED",
      attempts: 1,
    });
  });

  it("starts only one polling loop and drains its active handler on shutdown", async () => {
    const job = await createJob();
    let releaseHandler!: () => void;
    let markStarted!: () => void;
    const handlerStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const handler = vi.fn(async () => {
      markStarted();
      await handlerGate;
    });
    const worker = new OutboxWorker(prisma, {
      pollIntervalMs: 100,
      handleJob: handler,
    });

    worker.start();
    worker.start();
    await handlerStarted;
    const stopping = worker.stop();
    releaseHandler();
    await stopping;

    expect(handler).toHaveBeenCalledTimes(1);
    expect((await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } })).status)
      .toBe("COMPLETED");
  });

  it("recovers stale processing jobs and safely retries them", async () => {
    let currentTime = new Date();
    const job = await createJob({
      status: "PROCESSING",
      attempts: 1,
      updatedAt: new Date(currentTime.getTime() - 5000),
    });
    const handler = vi.fn(async () => undefined);
    const worker = new OutboxWorker(prisma, {
      now: () => currentTime,
      processingTimeoutMs: 500,
      staleProcessingMs: 1000,
      retryBaseDelayMs: 100,
      handleJob: handler,
    });

    expect(await worker.runOnce()).toBe(0);
    let stored = await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe("PENDING");
    expect(stored.lastError).toBe("Processing lease expired before completion");
    expect(stored.availableAt.getTime() - currentTime.getTime()).toBe(100);

    currentTime = new Date(currentTime.getTime() + 100);
    await prisma.outboxJob.update({
      where: { id: job.id },
      data: { availableAt: currentTime },
    });
    expect(await worker.runOnce()).toBe(1);
    stored = await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe("COMPLETED");
    expect(stored.attempts).toBe(2);
  });

  it("marks stale records at the attempt limit as terminal failures", async () => {
    const currentTime = new Date();
    const job = await createJob({
      status: "PROCESSING",
      attempts: 2,
      maxAttempts: 2,
      updatedAt: new Date(currentTime.getTime() - 5000),
    });
    const handler = vi.fn(async () => undefined);
    const worker = new OutboxWorker(prisma, {
      now: () => currentTime,
      processingTimeoutMs: 500,
      staleProcessingMs: 1000,
      handleJob: handler,
    });

    expect(await worker.runOnce()).toBe(0);
    expect(handler).not.toHaveBeenCalled();
    expect(await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "FAILED",
      attempts: 2,
      lastError: "Processing lease expired before completion",
    });
  });
});
