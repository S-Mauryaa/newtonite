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
});

export const env = envSchema.parse({ ...process.env, DATABASE_URL: databaseUrl });
