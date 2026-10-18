import { rateLimit } from "express-rate-limit";
import { env } from "../config/env";

interface LoginRateLimitOptions {
  windowMs?: number;
  maxAttempts?: number;
}

export function createLoginRateLimiter({
  windowMs = env.LOGIN_RATE_LIMIT_WINDOW_MS,
  maxAttempts = env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
}: LoginRateLimitOptions = {}) {
  return rateLimit({
    windowMs,
    limit: maxAttempts,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
      res.status(options.statusCode).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many login attempts. Please try again later.",
        },
      });
    },
  });
}
