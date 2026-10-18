import { Prisma } from "../generated/prisma/client";
import { env } from "../config/env";

export async function enqueueOutboxEvent(
  transaction: Prisma.TransactionClient,
  type: string,
  payload: Prisma.InputJsonObject,
): Promise<void> {
  await transaction.outboxJob.create({
    data: {
      type,
      payload,
      maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
    },
  });
}
