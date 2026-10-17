import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";

const seedPassword = process.env.SEED_DEMO_PASSWORD;
if (!seedPassword || seedPassword.length < 12) {
  throw new Error("Set SEED_DEMO_PASSWORD to a local demo password of at least 12 characters before seeding");
}

const teamSeeds = [
  { name: "Operations", slug: "operations" },
  { name: "Customer Success", slug: "customer-success" },
  { name: "Finance", slug: "finance" },
];

const userSeeds = [
  { name: "Alex Morgan", email: "alex@newtonite.local", team: "operations", role: "ADMIN" as const },
  { name: "Jamie Chen", email: "jamie@newtonite.local", team: "operations", role: "LEAD" as const },
  { name: "Taylor Brooks", email: "taylor@newtonite.local", team: "operations", role: "MEMBER" as const },
  { name: "Riley Patel", email: "riley@newtonite.local", team: "operations", role: "MEMBER" as const },
  { name: "Casey Kim", email: "casey@newtonite.local", team: "operations", role: "VIEWER" as const },
  { name: "Morgan Rivera", email: "morgan@newtonite.local", team: "customer-success", role: "LEAD" as const },
  { name: "Jordan Lee", email: "jordan@newtonite.local", team: "customer-success", role: "MEMBER" as const },
  { name: "Avery Shah", email: "avery@newtonite.local", team: "customer-success", role: "MEMBER" as const },
  { name: "Quinn Davis", email: "quinn@newtonite.local", team: "finance", role: "ADMIN" as const },
  { name: "Sam Wilson", email: "sam@newtonite.local", team: "finance", role: "MEMBER" as const },
];

async function seed() {
  const passwordHash = await bcrypt.hash(seedPassword, 12);
  const teams = new Map<string, string>();
  for (const team of teamSeeds) {
    const saved = await prisma.team.upsert({
      where: { slug: team.slug },
      update: { name: team.name },
      create: team,
    });
    teams.set(team.slug, saved.id);
  }

  const users = new Map<string, string>();
  for (const user of userSeeds) {
    const saved = await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, passwordHash },
      create: { name: user.name, email: user.email, passwordHash },
    });
    users.set(user.email, saved.id);
    await prisma.membership.upsert({
      where: {
        userId_teamId: {
          userId: saved.id,
          teamId: teams.get(user.team)!,
        },
      },
      update: { role: user.role },
      create: {
        userId: saved.id,
        teamId: teams.get(user.team)!,
        role: user.role,
      },
    });
  }

  const now = new Date();
  const itemSeeds = [
    { id: "seed-item-01", title: "Investigate payment retry spike", type: "PAYMENT" as const, priority: "URGENT" as const, status: "OPEN" as const, team: "operations", creator: "alex@newtonite.local", assignee: null, dueDate: new Date(now.getTime() - 86_400_000) },
    { id: "seed-item-02", title: "Review delayed customer settlement", type: "CUSTOMER_ISSUE" as const, priority: "HIGH" as const, status: "IN_PROGRESS" as const, team: "operations", creator: "jamie@newtonite.local", assignee: "taylor@newtonite.local", dueDate: new Date(now.getTime() + 86_400_000) },
    { id: "seed-item-03", title: "Approve revised compliance checklist", type: "COMPLIANCE" as const, priority: "MEDIUM" as const, status: "AWAITING_APPROVAL" as const, team: "operations", creator: "taylor@newtonite.local", assignee: "riley@newtonite.local", dueDate: null },
    { id: "seed-item-04", title: "Resolve duplicate account report", type: "INCIDENT" as const, priority: "LOW" as const, status: "RESOLVED" as const, team: "operations", creator: "jamie@newtonite.local", assignee: "taylor@newtonite.local", dueDate: null },
    { id: "seed-item-05", title: "Close completed access review", type: "TASK" as const, priority: "LOW" as const, status: "CLOSED" as const, team: "operations", creator: "alex@newtonite.local", assignee: "riley@newtonite.local", dueDate: null },
    { id: "seed-item-06", title: "Customer refund request", type: "PAYMENT" as const, priority: "HIGH" as const, status: "OPEN" as const, team: "customer-success", creator: "morgan@newtonite.local", assignee: null, dueDate: new Date(now.getTime() - 172_800_000) },
    { id: "seed-item-07", title: "Update onboarding guidance", type: "TASK" as const, priority: "MEDIUM" as const, status: "IN_PROGRESS" as const, team: "customer-success", creator: "jordan@newtonite.local", assignee: "avery@newtonite.local", dueDate: null },
    { id: "seed-item-08", title: "Investigate reconciliation mismatch", type: "INCIDENT" as const, priority: "URGENT" as const, status: "AWAITING_APPROVAL" as const, team: "finance", creator: "quinn@newtonite.local", assignee: "sam@newtonite.local", dueDate: new Date(now.getTime() + 172_800_000) },
    { id: "seed-item-09", title: "Prepare monthly close checklist", type: "TASK" as const, priority: "MEDIUM" as const, status: "OPEN" as const, team: "finance", creator: "sam@newtonite.local", assignee: null, dueDate: null },
    { id: "seed-item-10", title: "Review vendor compliance evidence", type: "COMPLIANCE" as const, priority: "HIGH" as const, status: "RESOLVED" as const, team: "finance", creator: "quinn@newtonite.local", assignee: "sam@newtonite.local", dueDate: null },
  ];

  for (const item of itemSeeds) {
    const saved = await prisma.workItem.upsert({
      where: { id: item.id },
      update: {
        title: item.title,
        type: item.type,
        priority: item.priority,
        status: item.status,
        teamId: teams.get(item.team)!,
        createdById: users.get(item.creator)!,
        assigneeId: item.assignee ? users.get(item.assignee)! : null,
        dueDate: item.dueDate,
      },
      create: {
        id: item.id,
        title: item.title,
        type: item.type,
        priority: item.priority,
        status: item.status,
        description: "",
        teamId: teams.get(item.team)!,
        createdById: users.get(item.creator)!,
        assigneeId: item.assignee ? users.get(item.assignee)! : null,
        dueDate: item.dueDate,
      },
    });
    const existingEvent = await prisma.activityEvent.findFirst({
      where: { workItemId: saved.id, action: "SEEDED", actorId: saved.createdById },
    });
    if (!existingEvent) {
      await prisma.activityEvent.create({
        data: {
          workItemId: saved.id,
          actorId: saved.createdById,
          action: "SEEDED",
          newValue: saved.title,
        },
      });
    }
  }

  console.log(`Seeded ${teamSeeds.length} teams, ${userSeeds.length} users, and ${itemSeeds.length} work items.`);
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error("Database seed failed", error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
