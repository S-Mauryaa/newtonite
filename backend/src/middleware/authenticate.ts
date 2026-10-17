import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { AppError } from "../utils/app-error";

export const authenticate: RequestHandler = async (req, _res, next) => {
  const authorization = req.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new AppError(401, "UNAUTHENTICATED", "Authentication is required");
  }

  try {
    const payload = jwt.verify(authorization.slice(7), env.JWT_SECRET);
    if (typeof payload === "string" || typeof payload.sub !== "string") {
      throw new AppError(401, "INVALID_TOKEN", "The access token is invalid");
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        memberships: { select: { teamId: true, role: true } },
      },
    });
    if (!user) {
      throw new AppError(401, "INVALID_TOKEN", "The access token is invalid");
    }

    req.auth = { userId: user.id, memberships: user.memberships };
    next();
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AppError(401, "INVALID_TOKEN", "The access token is invalid");
    }
    throw error;
  }
};
