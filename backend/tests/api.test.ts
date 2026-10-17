import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";

const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);
if (!databaseName.endsWith("_test")) {
  throw new Error("Integration tests require a dedicated database whose name ends with _test");
}

interface TestFixture {
  teamIds: string[];
  userIds: string[];
  itemIds: string[];
  emails: string[];
  password: string;
  tokens: Record<"member" | "secondMember" | "lead" | "outsider" | "viewer", string>;
}

let fixture: TestFixture;

async function createWorkItem(overrides: Record<string, unknown> = {}) {
  const response = await request(app)
    .post("/api/items")
    .set("Authorization", `Bearer ${fixture.tokens.member}`)
    .set("Idempotency-Key", randomUUID())
    .send({
      title: "Test incident",
      type: "INCIDENT",
      teamId: fixture.teamIds[0],
      ...overrides,
    });
  expect(response.status).toBe(201);
  fixture.itemIds.push(response.body.data.id as string);
  return response.body.data as { id: string; version: number; status: string };
}

beforeEach(async () => {
  fixture = { teamIds: [], userIds: [], itemIds: [], emails: [], password: "local-test-password", tokens: {} as TestFixture["tokens"] };
  const suffix = randomUUID();
  const [team, otherTeam] = await Promise.all([
    prisma.team.create({ data: { name: "Test team", slug: `test-${suffix}` } }),
    prisma.team.create({ data: { name: "Other team", slug: `other-${suffix}` } }),
  ]);
  fixture.teamIds.push(team.id, otherTeam.id);

  const passwordHash = await bcrypt.hash(fixture.password, 4);
  const roles = ["MEMBER", "MEMBER", "LEAD", "MEMBER", "VIEWER"] as const;
  const userNames = ["member", "second", "lead", "outsider", "viewer"] as const;
  for (let index = 0; index < userNames.length; index += 1) {
    const email = `${userNames[index]}-${suffix}@test.invalid`;
    const user = await prisma.user.create({
      data: { name: userNames[index], email, passwordHash },
    });
    fixture.userIds.push(user.id);
    fixture.emails.push(email);
    await prisma.membership.create({
      data: {
        userId: user.id,
        teamId: index === 3 ? otherTeam.id : team.id,
        role: roles[index],
      },
    });
    fixture.tokens[userNames[index] === "second" ? "secondMember" : userNames[index] as keyof TestFixture["tokens"]] =
      jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: "1h" });
  }
});

afterEach(async () => {
  if (!fixture) return;
  await prisma.activityEvent.deleteMany({ where: { workItem: { teamId: { in: fixture.teamIds } } } });
  await prisma.comment.deleteMany({ where: { workItem: { teamId: { in: fixture.teamIds } } } });
  await prisma.workItem.deleteMany({ where: { teamId: { in: fixture.teamIds } } });
  await prisma.idempotencyKey.deleteMany({ where: { userId: { in: fixture.userIds } } });
  await prisma.membership.deleteMany({ where: { teamId: { in: fixture.teamIds } } });
  await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
  await prisma.team.deleteMany({ where: { id: { in: fixture.teamIds } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Newtonite API", () => {
  it("keeps the health endpoint public", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
  });

  it("authenticates seeded identities and rejects invalid credentials uniformly", async () => {
    const success = await request(app)
      .post("/api/auth/login")
      .send({ email: fixture.emails[0], password: fixture.password });
    expect(success.status).toBe(200);
    expect(success.body.data.user.email).toBe(fixture.emails[0]);
    expect(success.body.data.user.passwordHash).toBeUndefined();

    const failure = await request(app)
      .post("/api/auth/login")
      .send({ email: fixture.emails[0], password: "wrong-password" });
    expect(failure.status).toBe(401);
    expect(failure.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("requires authentication and hides another team's items", async () => {
    const item = await createWorkItem();
    const unauthenticated = await request(app).get(`/api/items/${item.id}`);
    const outsider = await request(app)
      .get(`/api/items/${item.id}`)
      .set("Authorization", `Bearer ${fixture.tokens.outsider}`);
    expect(unauthenticated.status).toBe(401);
    expect(outsider.status).toBe(404);
  });

  it("creates work items and their audit event atomically", async () => {
    const item = await createWorkItem();
    const events = await prisma.activityEvent.findMany({ where: { workItemId: item.id } });
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("CREATED");
  });

  it("replays idempotent creation and rejects a changed payload", async () => {
    const key = randomUUID();
    const body = { title: "Idempotent task", type: "TASK", teamId: fixture.teamIds[0] };
    const first = await request(app)
      .post("/api/items")
      .set("Authorization", `Bearer ${fixture.tokens.member}`)
      .set("Idempotency-Key", key)
      .send(body);
    const replay = await request(app)
      .post("/api/items")
      .set("Authorization", `Bearer ${fixture.tokens.member}`)
      .set("Idempotency-Key", key)
      .send(body);
    const conflict = await request(app)
      .post("/api/items")
      .set("Authorization", `Bearer ${fixture.tokens.member}`)
      .set("Idempotency-Key", key)
      .send({ ...body, title: "Changed task" });

    fixture.itemIds.push(first.body.data.id as string);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(conflict.status).toBe(409);
  });

  it("includes normalized date fields in the idempotency fingerprint", async () => {
    const key = randomUUID();
    const body = {
      title: "Date-bound task",
      type: "TASK",
      teamId: fixture.teamIds[0],
      dueDate: "2026-11-01T00:00:00.000Z",
    };
    const first = await request(app)
      .post("/api/items")
      .set("Authorization", `Bearer ${fixture.tokens.member}`)
      .set("Idempotency-Key", key)
      .send(body);
    const changed = await request(app)
      .post("/api/items")
      .set("Authorization", `Bearer ${fixture.tokens.member}`)
      .set("Idempotency-Key", key)
      .send({ ...body, dueDate: "2026-11-02T00:00:00.000Z" });
    fixture.itemIds.push(first.body.data.id as string);
    expect(first.status).toBe(201);
    expect(changed.status).toBe(409);
  });

  it("creates only one item for concurrent requests with the same idempotency key", async () => {
    const key = randomUUID();
    const body = { title: "Concurrent create", type: "TASK", teamId: fixture.teamIds[0] };
    const create = () =>
      request(app)
        .post("/api/items")
        .set("Authorization", `Bearer ${fixture.tokens.member}`)
        .set("Idempotency-Key", key)
        .send(body);
    const responses = await Promise.all([create(), create()]);
    const ids = responses.map(({ body: responseBody }) => responseBody.data.id as string);
    expect(responses.every(({ status }) => status === 201)).toBe(true);
    expect(new Set(ids).size).toBe(1);
    fixture.itemIds.push(ids[0]);
    expect(await prisma.workItem.count({ where: { id: ids[0] } })).toBe(1);
  });

  it("allows exactly one of two concurrent claims", async () => {
    const item = await createWorkItem();
    const claim = (token: string) =>
      request(app)
        .post(`/api/items/${item.id}/claim`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
    const responses = await Promise.all([
      claim(fixture.tokens.member),
      claim(fixture.tokens.secondMember),
    ]);
    expect(responses.filter(({ status }) => status === 200)).toHaveLength(1);
    expect(responses.filter(({ status }) => status === 409)).toHaveLength(1);
    expect(await prisma.workItem.count({ where: { id: item.id, assigneeId: { not: null } } })).toBe(1);
    expect(await prisma.activityEvent.count({ where: { workItemId: item.id, action: "CLAIMED" } })).toBe(1);
  });

  it("rejects stale edits without overwriting the newer version", async () => {
    const item = await createWorkItem();
    const edit = (title: string) =>
      request(app)
        .patch(`/api/items/${item.id}`)
        .set("Authorization", `Bearer ${fixture.tokens.member}`)
        .send({ title, version: item.version });
    const first = await edit("First update");
    const stale = await edit("Stale update");
    expect(first.status).toBe(200);
    expect(stale.status).toBe(409);
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe("First update");
    expect(await prisma.activityEvent.count({ where: { workItemId: item.id } })).toBe(2);
  });

  it("enforces workflow validity and lead approval", async () => {
    const item = await createWorkItem();
    const skipped = await request(app)
      .post(`/api/items/${item.id}/transition`)
      .set("Authorization", `Bearer ${fixture.tokens.member}`)
      .send({ status: "CLOSED", version: 1 });
    expect(skipped.status).toBe(422);

    await prisma.workItem.update({ where: { id: item.id }, data: { status: "AWAITING_APPROVAL" } });
    const memberApproval = await request(app)
      .post(`/api/items/${item.id}/transition`)
      .set("Authorization", `Bearer ${fixture.tokens.member}`)
      .send({ status: "RESOLVED", version: 1 });
    const leadApproval = await request(app)
      .post(`/api/items/${item.id}/transition`)
      .set("Authorization", `Bearer ${fixture.tokens.lead}`)
      .send({ status: "RESOLVED", version: 1 });
    expect(memberApproval.status).toBe(403);
    expect(leadApproval.status).toBe(200);
  });

  it("restricts list filters and dashboard metrics to team memberships", async () => {
    await createWorkItem({ priority: "URGENT" });
    const list = await request(app)
      .get("/api/items")
      .query({ teamId: fixture.teamIds[1] })
      .set("Authorization", `Bearer ${fixture.tokens.member}`);
    const dashboard = await request(app)
      .get("/api/dashboard")
      .set("Authorization", `Bearer ${fixture.tokens.member}`);
    expect(list.status).toBe(404);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.unassignedUrgent).toBe(1);
  });

  it("supports filtered cursor pagination", async () => {
    await createWorkItem({ title: "First page", priority: "HIGH" });
    await createWorkItem({ title: "Second page", priority: "HIGH" });
    await createWorkItem({ title: "Filtered out", priority: "LOW" });

    const first = await request(app)
      .get("/api/items")
      .query({ teamId: fixture.teamIds[0], priority: "HIGH", pageSize: 1 })
      .set("Authorization", `Bearer ${fixture.tokens.member}`);
    const second = await request(app)
      .get("/api/items")
      .query({
        teamId: fixture.teamIds[0],
        priority: "HIGH",
        pageSize: 1,
        cursor: first.body.meta.nextCursor,
      })
      .set("Authorization", `Bearer ${fixture.tokens.member}`);

    expect(first.body.data).toHaveLength(1);
    expect(first.body.meta.nextCursor).toBeTruthy();
    expect(second.body.data).toHaveLength(1);
    expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
    expect(second.body.data[0].priority).toBe("HIGH");
  });

  it("creates comments and matching activity events for team writers", async () => {
    const item = await createWorkItem();
    const comment = await request(app)
      .post(`/api/items/${item.id}/comments`)
      .set("Authorization", `Bearer ${fixture.tokens.member}`)
      .send({ body: "Investigating this now." });
    const comments = await request(app)
      .get(`/api/items/${item.id}/comments`)
      .set("Authorization", `Bearer ${fixture.tokens.member}`);
    const activity = await request(app)
      .get(`/api/items/${item.id}/activity`)
      .set("Authorization", `Bearer ${fixture.tokens.member}`);

    expect(comment.status).toBe(201);
    expect(comments.body.data).toHaveLength(1);
    expect(activity.body.data.some((event: { action: string }) => event.action === "COMMENTED")).toBe(true);
  });
});
