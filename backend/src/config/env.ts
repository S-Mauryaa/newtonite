import "dotenv/config";
import { z } from "zod";

const databaseUrl =
  process.env.NODE_ENV === "test"
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL;

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(5001),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.enum(["15m", "1h", "4h", "12h", "1d", "7d"]).default("1h"),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86400000).default(900000),
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(10),
  OUTBOX_WORKER_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60000).default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  OUTBOX_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).max(3600000).default(1000),
  OUTBOX_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(100).max(86400000).default(60000),
  OUTBOX_PROCESSING_TIMEOUT_MS: z.coerce.number().int().min(100).max(3600000).default(30000),
  OUTBOX_STALE_PROCESSING_MS: z.coerce.number().int().min(1000).max(86400000).default(60000),
});

export const env = envSchema.parse({ ...process.env, DATABASE_URL: databaseUrl });

if (env.OUTBOX_RETRY_MAX_DELAY_MS < env.OUTBOX_RETRY_BASE_DELAY_MS) {
  throw new Error("OUTBOX_RETRY_MAX_DELAY_MS must be at least OUTBOX_RETRY_BASE_DELAY_MS");
}
if (env.OUTBOX_STALE_PROCESSING_MS <= env.OUTBOX_PROCESSING_TIMEOUT_MS) {
  throw new Error("OUTBOX_STALE_PROCESSING_MS must exceed OUTBOX_PROCESSING_TIMEOUT_MS");
}
