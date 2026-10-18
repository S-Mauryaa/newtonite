import { vi } from "vitest";
import type { WorkItemDetails } from "../lib/api";

export interface MockRequest {
  url: URL;
  method: string;
  headers: Headers;
  body: unknown;
  signal: AbortSignal | null;
}

export type ApiHandler = (
  request: MockRequest,
) => Response | Promise<Response>;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function mockApi(handler: ApiHandler) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      let body: unknown;
      if (typeof init?.body === "string") body = JSON.parse(init.body);
      if (init?.signal?.aborted) {
        throw new DOMException("The request was aborted.", "AbortError");
      }
      return handler({
        url,
        method: init?.method ?? "GET",
        headers,
        body,
        signal: init?.signal ?? null,
      });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export const member = {
  id: "user-1",
  name: "Morgan Member",
  email: "morgan@example.test",
  memberships: [
    {
      role: "MEMBER",
      team: { id: "team-ops", name: "Operations", slug: "operations" },
    },
    {
      role: "ADMIN",
      team: { id: "team-fin", name: "Finance", slug: "finance" },
    },
  ],
};

export const viewer = {
  ...member,
  id: "user-viewer",
  memberships: [
    {
      role: "VIEWER",
      team: { id: "team-ops", name: "Operations", slug: "operations" },
    },
  ],
};

export function item(
  id: string,
  title: string,
  teamId = "team-ops",
  overrides: Partial<WorkItemDetails> = {},
): WorkItemDetails {
  const team =
    teamId === "team-fin"
      ? { id: "team-fin", name: "Finance", slug: "finance" }
      : { id: "team-ops", name: "Operations", slug: "operations" };
  return {
    id,
    title,
    description: "Test item description",
    type: "TASK",
    status: "OPEN",
    priority: "MEDIUM",
    teamId,
    assigneeId: null,
    createdById: "user-1",
    dueDate: null,
    version: 1,
    createdAt: "2026-10-18T10:00:00.000Z",
    updatedAt: "2026-10-18T10:00:00.000Z",
    team,
    assignee: null,
    createdBy: {
      id: "user-1",
      name: "Morgan Member",
      email: "morgan@example.test",
    },
    ...overrides,
  };
}

export function activityEvent(
  id: string,
  workItemId: string,
  action: string,
  newValue: string | null = null,
) {
  return {
    id,
    workItemId,
    actorId: "user-1",
    action,
    previousValue: null,
    newValue,
    metadata: null,
    createdAt: "2026-10-18T10:01:00.000Z",
    actor: { id: "user-1", name: "Morgan Member" },
  };
}

export function comment(id: string, workItemId: string, body: string) {
  return {
    id,
    workItemId,
    authorId: "user-1",
    body,
    createdAt: "2026-10-18T10:02:00.000Z",
    updatedAt: "2026-10-18T10:02:00.000Z",
    author: { id: "user-1", name: "Morgan Member" },
  };
}

export function loginResponse(user = member): Response {
  return jsonResponse({
    data: {
      accessToken: "test-access-token",
      tokenType: "Bearer",
      expiresIn: "1h",
      user,
    },
  });
}

export function dashboardResponse(assignedToMe = 2): Response {
  return jsonResponse({
    data: {
      assignedToMe,
      unassignedUrgent: 3,
      awaitingApproval: 4,
      overdue: 5,
      itemsByStatus: {
        OPEN: 6,
        IN_PROGRESS: 7,
        AWAITING_APPROVAL: 8,
        RESOLVED: 9,
        CLOSED: 10,
      },
    },
  });
}

export function loginRequest(request: MockRequest): boolean {
  return request.url.pathname === "/api/auth/login" && request.method === "POST";
}
