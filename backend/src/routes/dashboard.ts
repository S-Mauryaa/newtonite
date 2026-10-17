import { Router } from "express";
import { WorkItemStatus } from "../generated/prisma/enums";
import { authenticate } from "../middleware/authenticate";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/app-error";

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

dashboardRouter.get("/", async (req, res) => {
  if (!req.auth) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required");
  const teamIds = req.auth.memberships.map(({ teamId }) => teamId);
  const approvalTeamIds = req.auth.memberships
    .filter(({ role }) => role === "LEAD" || role === "ADMIN")
    .map(({ teamId }) => teamId);
  const now = new Date();

  const [assignedToMe, unassignedUrgent, awaitingApproval, statusGroups, overdue] =
    await Promise.all([
      prisma.workItem.count({ where: { teamId: { in: teamIds }, assigneeId: req.auth.userId } }),
      prisma.workItem.count({
        where: { teamId: { in: teamIds }, assigneeId: null, priority: "URGENT" },
      }),
      prisma.workItem.count({
        where: { teamId: { in: approvalTeamIds }, status: "AWAITING_APPROVAL" },
      }),
      prisma.workItem.groupBy({
        by: ["status"],
        where: { teamId: { in: teamIds } },
        _count: { _all: true },
      }),
      prisma.workItem.count({
        where: {
          teamId: { in: teamIds },
          dueDate: { lt: now },
          status: { notIn: ["RESOLVED", "CLOSED"] },
        },
      }),
    ]);

  const itemsByStatus = Object.fromEntries(
    Object.values(WorkItemStatus).map((status) => [
      status,
      statusGroups.find((group) => group.status === status)?._count._all ?? 0,
    ]),
  );
  res.json({
    data: { assignedToMe, unassignedUrgent, awaitingApproval, itemsByStatus, overdue },
  });
});
