import type { TeamRole } from "../generated/prisma/client";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        memberships: Array<{ teamId: string; role: TeamRole }>;
      };
    }
  }
}

export {};
