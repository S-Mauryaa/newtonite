import { createHash } from "node:crypto";
import { Router } from "express";
import { Prisma } from "../generated/prisma/client";
import {
  WorkItemPriority,
  WorkItemStatus,
  WorkItemType,
} from "../generated/prisma/enums";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/authenticate";
import { requireMembership, requireTeamWrite } from "../services/authorization";
import { validateTransition } from "../services/workflow";
import { AppError } from "../utils/app-error";

export const itemsRouter = Router();
itemsRouter.use(authenticate);

const createItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).default(""),
  type: z.nativeEnum(WorkItemType),
  priority: z.nativeEnum(WorkItemPriority).default("MEDIUM"),
  teamId: z.string().min(1),
  assigneeId: z.string().min(1).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
}).strict();

const updateItemSchema = z.object({
  version: z.number().int().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10000).optional(),
  type: z.nativeEnum(WorkItemType).optional(),
  priority: z.nativeEnum(WorkItemPriority).optional(),
  dueDate: z.coerce.date().nullable().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "version"), {
  message: "At least one editable field is required",
});

const listSchema = z.object({
  status: z.nativeEnum(WorkItemStatus).optional(),
  priority: z.nativeEnum(WorkItemPriority).optional(),
  type: z.nativeEnum(WorkItemType).optional(),
  assigneeId: z.string().optional(),
  teamId: z.string().optional(),
  search: z.string().trim().max(200).optional(),
  sortBy: z.enum(["updatedAt", "createdAt", "dueDate", "priority"]).default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  cursor: z.string().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const commentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
}).strict();

function authFor(req: Express.Request) {
  if (!req.auth) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required");
  return req.auth;
}

async function authorizedItem(id: string, memberships: Array<{ teamId: string; role: "VIEWER" | "MEMBER" | "LEAD" | "ADMIN" }>) {
  const item = await prisma.workItem.findUnique({
    where: { id },
    include: {
      team: { select: { id: true, name: true, slug: true } },
      assignee: { select: { id: true, name: true, email: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!item) throw new AppError(404, "NOT_FOUND", "Work item not found");
  requireMembership(memberships, item.teamId);
  return item;
}

function fingerprint(input: unknown): string {
  const canonicalize = (value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, canonicalize(entry)]),
      );
    }
    return value;
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(input))).digest("hex");
}

itemsRouter.post("/", async (req, res) => {
  const auth = authFor(req);
  const input = createItemSchema.parse(req.body);
  const role = requireMembership(auth.memberships, input.teamId);
  requireTeamWrite(role);

  if (input.assigneeId && input.assigneeId !== auth.userId) {
    const assigneeMembership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId: input.assigneeId, teamId: input.teamId } },
      select: { userId: true },
    });
    if (!assigneeMembership) {
      throw new AppError(400, "INVALID_ASSIGNEE", "Assignee must belong to the selected team");
    }
  }

  const idempotencyKey = req.header("idempotency-key");
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header (maximum 200 characters)");
  }
  const requestFingerprint = fingerprint(input);
  const operation = "POST:/api/items";

  try {
    const itemResult = await prisma.$transaction(async (tx) => {
      await tx.idempotencyKey.create({
        data: {
          userId: auth.userId,
          operation,
          key: idempotencyKey,
          fingerprint: requestFingerprint,
        },
      });

      const item = await tx.workItem.create({
        data: {
          title: input.title,
          description: input.description,
          type: input.type,
          priority: input.priority,
          teamId: input.teamId,
          assigneeId: input.assigneeId,
          dueDate: input.dueDate,
          createdById: auth.userId,
        },
      });
      await tx.activityEvent.create({
        data: {
          workItemId: item.id,
          actorId: auth.userId,
          action: "CREATED",
          newValue: item.title,
        },
      });

      const response = {
        id: item.id,
        title: item.title,
        description: item.description,
        type: item.type,
        priority: item.priority,
        status: item.status,
        teamId: item.teamId,
        assigneeId: item.assigneeId,
        createdById: item.createdById,
        dueDate: item.dueDate?.toISOString() ?? null,
        version: item.version,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      };
      await tx.idempotencyKey.update({
        where: {
          userId_operation_key: { userId: auth.userId, operation, key: idempotencyKey },
        },
        data: { response },
      });
      return { response, replayed: false };
    });
    res.status(201).json({ data: itemResult.response, replayed: itemResult.replayed });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    const prior = await prisma.idempotencyKey.findUnique({
      where: {
        userId_operation_key: { userId: auth.userId, operation, key: idempotencyKey },
      },
    });
    if (!prior) throw error;
    if (prior.fingerprint !== requestFingerprint) {
      throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different request");
    }
    if (!prior.response) {
      throw new AppError(409, "REQUEST_IN_PROGRESS", "A request with this Idempotency-Key is still in progress");
    }
    res.status(201).json({ data: prior.response, replayed: true });
  }
});

itemsRouter.get("/", async (req, res) => {
  const auth = authFor(req);
  const query = listSchema.parse(req.query);
  if (query.teamId) requireMembership(auth.memberships, query.teamId);
  const teamIds = query.teamId
    ? [query.teamId]
    : auth.memberships.map((membership) => membership.teamId);

  const where: Prisma.WorkItemWhereInput = {
    teamId: { in: teamIds },
    status: query.status,
    priority: query.priority,
    type: query.type,
    assigneeId: query.assigneeId === "unassigned" ? null : query.assigneeId,
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: "insensitive" } },
            { description: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const items = await prisma.workItem.findMany({
    where,
    include: {
      team: { select: { id: true, name: true, slug: true } },
      assignee: { select: { id: true, name: true } },
    },
    orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "desc" }],
    take: query.pageSize + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = items.length > query.pageSize;
  const data = hasMore ? items.slice(0, query.pageSize) : items;
  res.json({
    data,
    meta: { nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null },
  });
});

itemsRouter.get("/:id", async (req, res) => {
  const auth = authFor(req);
  const item = await authorizedItem(req.params.id, auth.memberships);
  res.json({ data: item });
});

itemsRouter.get("/:id/activity", async (req, res) => {
  const auth = authFor(req);
  const item = await authorizedItem(req.params.id, auth.memberships);
  const query = z.object({
    cursor: z.string().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  }).parse(req.query);
  const events = await prisma.activityEvent.findMany({
    where: { workItemId: item.id },
    include: { actor: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: query.pageSize + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = events.length > query.pageSize;
  const data = hasMore ? events.slice(0, query.pageSize) : events;
  res.json({ data, meta: { nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null } });
});

itemsRouter.get("/:id/comments", async (req, res) => {
  const auth = authFor(req);
  const item = await authorizedItem(req.params.id, auth.memberships);
  const comments = await prisma.comment.findMany({
    where: { workItemId: item.id },
    include: { author: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  res.json({ data: comments });
});

itemsRouter.post("/:id/comments", async (req, res) => {
  const auth = authFor(req);
  const input = commentSchema.parse(req.body);
  const item = await authorizedItem(req.params.id, auth.memberships);
  const role = requireMembership(auth.memberships, item.teamId);
  requireTeamWrite(role);
  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: { workItemId: item.id, authorId: auth.userId, body: input.body },
      include: { author: { select: { id: true, name: true } } },
    });
    await tx.activityEvent.create({
      data: {
        workItemId: item.id,
        actorId: auth.userId,
        action: "COMMENTED",
        newValue: created.id,
      },
    });
    return created;
  });
  res.status(201).json({ data: comment });
});

itemsRouter.patch("/:id", async (req, res) => {
  const auth = authFor(req);
  const input = updateItemSchema.parse(req.body);
  const item = await authorizedItem(req.params.id, auth.memberships);
  const role = requireMembership(auth.memberships, item.teamId);
  requireTeamWrite(role);

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.workItem.updateMany({
      where: { id: item.id, version: input.version },
      data: {
        title: input.title,
        description: input.description,
        type: input.type,
        priority: input.priority,
        dueDate: input.dueDate,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new AppError(409, "VERSION_CONFLICT", "The work item changed; reload it and retry with the latest version");
    }

    for (const field of ["title", "description", "type", "priority", "dueDate"] as const) {
      const nextValue = input[field];
      if (nextValue === undefined) continue;
      const previous = item[field];
      const previousValue = previous instanceof Date ? previous.toISOString() : String(previous);
      const newValue = nextValue instanceof Date ? nextValue.toISOString() : String(nextValue);
      if (previousValue !== newValue) {
        await tx.activityEvent.create({
          data: {
            workItemId: item.id,
            actorId: auth.userId,
            action: "FIELD_UPDATED",
            previousValue,
            newValue,
            metadata: { field },
          },
        });
      }
    }
    return tx.workItem.findUniqueOrThrow({ where: { id: item.id } });
  });
  res.json({ data: updated });
});

itemsRouter.post("/:id/claim", async (req, res) => {
  const auth = authFor(req);
  const item = await authorizedItem(req.params.id, auth.memberships);
  requireTeamWrite(requireMembership(auth.memberships, item.teamId));

  const claimed = await prisma.$transaction(async (tx) => {
    const result = await tx.workItem.updateMany({
      where: { id: item.id, assigneeId: null, status: "OPEN" },
      data: { assigneeId: auth.userId, version: { increment: 1 } },
    });
    if (result.count !== 1) {
      throw new AppError(409, "CLAIM_CONFLICT", "This item is assigned or is no longer eligible to claim");
    }
    const updated = await tx.workItem.findUniqueOrThrow({ where: { id: item.id } });
    await tx.activityEvent.create({
      data: {
        workItemId: item.id,
        actorId: auth.userId,
        action: "CLAIMED",
        previousValue: null,
        newValue: auth.userId,
      },
    });
    return updated;
  });
  res.json({ data: claimed });
});

itemsRouter.post("/:id/transition", async (req, res) => {
  const auth = authFor(req);
  const input = z.object({
    status: z.nativeEnum(WorkItemStatus),
    version: z.number().int().min(1),
  }).strict().parse(req.body);
  const item = await authorizedItem(req.params.id, auth.memberships);
  const role = requireMembership(auth.memberships, item.teamId);
  requireTeamWrite(role);
  if (item.version !== input.version) {
    throw new AppError(409, "VERSION_CONFLICT", "The work item changed; reload it and retry with the latest version");
  }
  validateTransition(item.status, input.status, role);

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.workItem.updateMany({
      where: { id: item.id, version: input.version },
      data: { status: input.status, version: { increment: 1 } },
    });
    if (result.count !== 1) {
      throw new AppError(409, "VERSION_CONFLICT", "The work item changed; reload it and retry with the latest version");
    }
    await tx.activityEvent.create({
      data: {
        workItemId: item.id,
        actorId: auth.userId,
        action: "STATUS_CHANGED",
        previousValue: item.status,
        newValue: input.status,
      },
    });
    return tx.workItem.findUniqueOrThrow({ where: { id: item.id } });
  });
  res.json({ data: updated });
});
