import { Router, type RequestHandler } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { createLoginRateLimiter } from "../middleware/login-rate-limit";
import { AppError } from "../utils/app-error";

const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
});

const dummyPasswordHash = "$2b$12$JI4zf8EAG1DPCHbe5rH.Cu4I6Y2CRabIt2Qj6qiwExCwGiH50s1n2";

export function createAuthRouter(loginRateLimiter: RequestHandler = createLoginRateLimiter()) {
  const router = Router();

  router.post(
    "/login",
    loginRateLimiter,
    async (req, res) => {
      const input = loginSchema.parse(req.body);
      const user = await prisma.user.findUnique({
        where: { email: input.email.toLowerCase() },
        select: {
          id: true,
          name: true,
          email: true,
          passwordHash: true,
          memberships: {
            select: {
              role: true,
              team: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      });

      const passwordHash = user?.passwordHash ?? dummyPasswordHash;
      const passwordMatches = await bcrypt.compare(input.password, passwordHash);
      if (!user || !passwordMatches) {
        throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
      }

      const accessToken = jwt.sign({ sub: user.id }, env.JWT_SECRET, {
        expiresIn: env.JWT_EXPIRES_IN,
      });

      res.json({
        data: {
          accessToken,
          tokenType: "Bearer",
          expiresIn: env.JWT_EXPIRES_IN,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            memberships: user.memberships,
          },
        },
      });
    },
  );

  return router;
}

export const authRouter = createAuthRouter();
