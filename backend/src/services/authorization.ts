import type { TeamRole } from "../generated/prisma/client";
import { AppError } from "../utils/app-error";

const writeRoles: TeamRole[] = ["MEMBER", "LEAD", "ADMIN"];
const adminRoles: TeamRole[] = ["LEAD", "ADMIN"];

export function requireMembership(
  memberships: Array<{ teamId: string; role: TeamRole }>,
  teamId: string,
): TeamRole {
  const membership = memberships.find((entry) => entry.teamId === teamId);
  if (!membership) {
    throw new AppError(404, "NOT_FOUND", "Work item not found");
  }
  return membership.role;
}

export function requireTeamWrite(role: TeamRole): void {
  if (!writeRoles.includes(role)) {
    throw new AppError(403, "FORBIDDEN", "Your team role does not allow this action");
  }
}

export function requireTeamAdmin(role: TeamRole): void {
  if (!adminRoles.includes(role)) {
    throw new AppError(403, "FORBIDDEN", "A team lead or admin role is required");
  }
}
