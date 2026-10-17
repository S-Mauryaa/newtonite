import type { TeamRole, WorkItemStatus } from "../generated/prisma/client";
import { AppError } from "../utils/app-error";
import { requireTeamAdmin } from "./authorization";

const allowedTransitions: Record<WorkItemStatus, WorkItemStatus[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["OPEN", "AWAITING_APPROVAL"],
  AWAITING_APPROVAL: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["IN_PROGRESS", "CLOSED"],
  CLOSED: [],
};

export function validateTransition(
  current: WorkItemStatus,
  target: WorkItemStatus,
  role: TeamRole,
): void {
  if (!allowedTransitions[current].includes(target)) {
    throw new AppError(422, "INVALID_TRANSITION", `Cannot transition a ${current} item to ${target}`);
  }
  if (current === "AWAITING_APPROVAL" && target === "RESOLVED") {
    requireTeamAdmin(role);
  }
}
