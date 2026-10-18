import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import type { WorkItemDetails } from "./lib/api";
import {
  activityEvent,
  comment,
  dashboardResponse,
  item,
  jsonResponse,
  loginRequest,
  loginResponse,
  member,
  mockApi,
  viewer,
  type MockRequest,
} from "./test/api-mock";

function dashboardRequest(request: MockRequest): boolean {
  return request.url.pathname === "/api/dashboard";
}

function listRequest(request: MockRequest): boolean {
  return request.url.pathname === "/api/items" && request.method === "GET";
}

function apiError(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status);
}

async function signIn(user = member) {
  const userActions = userEvent.setup();
  await userActions.type(screen.getByLabelText("Email"), user.email);
  await userActions.type(screen.getByLabelText("Password"), "safe-test-password");
  await userActions.click(screen.getByRole("button", { name: "Sign in" }));
  return userActions;
}

function setSuccessfulAuthentication(
  handler: (request: MockRequest) => Response | Promise<Response>,
) {
  return mockApi(async (request) => {
    if (request.url.pathname === "/api/health") {
      return jsonResponse({ status: "ok", message: "API ready" });
    }
    if (loginRequest(request)) return loginResponse();
    return handler(request);
  });
}

function listItemResponse(id: string, title: string, teamId = "team-ops") {
  const team =
    teamId === "team-fin"
      ? { id: "team-fin", name: "Finance", slug: "finance" }
      : { id: "team-ops", name: "Operations", slug: "operations" };
  return {
    id,
    title,
    type: "TASK",
    status: "OPEN",
    priority: "MEDIUM",
    dueDate: null,
    team,
    assignee: null,
  };
}

describe("authentication", () => {
  it("renders login, signs in, renders the workspace, and clears the in-memory session on logout", async () => {
    const fetchMock = setSuccessfulAuthentication((request) => {
      if (dashboardRequest(request)) return dashboardResponse();
      if (listRequest(request)) return jsonResponse({ data: [], meta: { nextCursor: null } });
      return jsonResponse({ data: {} });
    });
    render(<App />);

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    await signIn();
    expect(await screen.findByRole("heading", { name: "You’re signed in" }))
      .toBeInTheDocument();

    await waitFor(() => {
      const dashboardCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/api/dashboard"),
      );
      expect(new Headers(dashboardCall?.[1]?.headers).get("Authorization"))
        .toBe("Bearer test-access-token");
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Welcome back" }))
      .toBeInTheDocument();
  });

  it("shows invalid credentials and clears the session after an authenticated 401", async () => {
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) {
        return apiError(401, "INVALID_CREDENTIALS", "Invalid credentials");
      }
      return jsonResponse({ data: {} });
    });
    const { unmount } = render(<App />);
    await signIn();
    expect(await screen.findByText("Email or password is incorrect."))
      .toBeInTheDocument();
    unmount();

    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) {
        return apiError(401, "UNAUTHENTICATED", "Session expired");
      }
      return jsonResponse({ data: [], meta: { nextCursor: null } });
    });
    render(<App />);
    await signIn();
    expect(await screen.findByRole("heading", { name: "Welcome back" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "You’re signed in" }))
      .not.toBeInTheDocument();
  });
});

describe("dashboard", () => {
  it("shows loading and then all four metrics and five aggregate status counts", async () => {
    let resolveDashboard!: (response: Response) => void;
    const fetchMock = mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) {
        return new Promise<Response>((resolve) => {
          resolveDashboard = resolve;
        });
      }
      if (listRequest(request)) return jsonResponse({ data: [], meta: { nextCursor: null } });
      return jsonResponse({ data: {} });
    });
    render(<App />);
    await signIn();
    expect(await screen.findByText("Loading dashboard…")).toBeInTheDocument();
    resolveDashboard(dashboardResponse());

    const dashboard = screen.getByRole("region", { name: "Dashboard" });
    expect(await within(dashboard).findByText("Metrics across all teams you belong to."))
      .toBeInTheDocument();
    for (const [label, count] of [
      ["Assigned to me", "2"],
      ["Unassigned urgent", "3"],
      ["Awaiting my approval", "4"],
      ["Overdue", "5"],
      ["OPEN", "6"],
      ["IN PROGRESS", "7"],
      ["AWAITING APPROVAL", "8"],
      ["RESOLVED", "9"],
      ["CLOSED", "10"],
    ]) {
      expect(within(dashboard).getByText(label)).toBeInTheDocument();
      expect(within(dashboard).getByText(count)).toBeInTheDocument();
    }
    const dashboardRequestUrl = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/api/dashboard"),
    )?.[0];
    expect(String(dashboardRequestUrl)).not.toContain("teamId");
  });

  it("retries a failed request and manually refreshes metrics", async () => {
    let dashboardCalls = 0;
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) {
        dashboardCalls += 1;
        return dashboardCalls === 1
          ? apiError(500, "INTERNAL_ERROR", "Dashboard unavailable")
          : dashboardResponse(dashboardCalls);
      }
      if (listRequest(request)) return jsonResponse({ data: [], meta: { nextCursor: null } });
      return jsonResponse({ data: {} });
    });
    render(<App />);
    const user = await signIn();
    expect(await screen.findByText("Dashboard unavailable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Assigned to me")).toBeInTheDocument();
    const dashboard = screen.getByRole("region", { name: "Dashboard" });
    expect(within(dashboard).getByText("2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh dashboard" }));
    await waitFor(() => expect(dashboardCalls).toBe(3));
    await waitFor(() => {
      expect(dashboard.querySelector(".dashboard__metric strong"))
        .toHaveTextContent("3");
    });
  });

  it("shows the no-team state and skips the dashboard request", async () => {
    const fetchMock = mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) {
        return loginResponse({ ...member, memberships: [] });
      }
      return jsonResponse({ data: {} });
    });
    render(<App />);
    await signIn();
    expect(await screen.findByText("Join a team to see your operational dashboard."))
      .toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/dashboard")))
      .toBe(false);
  });
});

describe("work-item list and creation", () => {
  it("renders initial results, sends filters/search to the API, and appends cursor pages", async () => {
    const queried: URL[] = [];
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) return dashboardResponse();
      if (listRequest(request)) {
        queried.push(request.url);
        if (request.url.searchParams.has("cursor")) {
          return jsonResponse({
            data: [listItemResponse("item-2", "Second item")],
            meta: { nextCursor: null },
          });
        }
        return jsonResponse({
          data: [listItemResponse("item-1", "First item")],
          meta: { nextCursor: "item-1" },
        });
      }
      return jsonResponse({ data: {} });
    });
    render(<App />);
    const user = await signIn();

    expect(await screen.findByRole("button", { name: "First item" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search work items"), "urgent");
    await user.selectOptions(screen.getByLabelText("Filter by status"), "OPEN");
    await user.selectOptions(screen.getByLabelText("Filter by priority"), "HIGH");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(queried.at(-1)?.searchParams.get("search")).toBe("urgent"));
    expect(queried.at(-1)?.searchParams.get("status")).toBe("OPEN");
    expect(queried.at(-1)?.searchParams.get("priority")).toBe("HIGH");

    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("button", { name: "Second item" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "First item" })).toHaveLength(1);
    expect(queried.at(-1)?.searchParams.get("cursor")).toBe("item-1");
  });

  it("retries a list error and displays the empty state", async () => {
    let listCalls = 0;
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) return dashboardResponse();
      if (listRequest(request)) {
        listCalls += 1;
        if (listCalls === 1) throw new Error("Network unavailable");
        return jsonResponse({ data: [], meta: { nextCursor: null } });
      }
      return jsonResponse({ data: {} });
    });
    render(<App />);
    const user = await signIn();
    expect(await screen.findByText("Network unavailable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No work items match these filters."))
      .toBeInTheDocument();
    expect(listCalls).toBe(2);
  });

  it("switches team queries and ignores a late response from the prior team", async () => {
    let resolveOperations!: (response: Response) => void;
    const requestedTeams: string[] = [];
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) return dashboardResponse();
      if (listRequest(request)) {
        const teamId = request.url.searchParams.get("teamId") ?? "";
        requestedTeams.push(teamId);
        if (teamId === "team-ops") {
          return new Promise<Response>((resolve) => {
            resolveOperations = resolve;
          });
        }
        return jsonResponse({
          data: [listItemResponse("finance-item", "Finance item", "team-fin")],
          meta: { nextCursor: null },
        });
      }
      return jsonResponse({ data: {} });
    });
    render(<App />);
    const user = await signIn();
    await user.selectOptions(screen.getByLabelText("Team"), "team-fin");
    expect(await screen.findByRole("button", { name: "Finance item" })).toBeInTheDocument();
    resolveOperations(jsonResponse({
      data: [listItemResponse("operations-item", "Late operations item")],
      meta: { nextCursor: null },
    }));
    expect(screen.queryByRole("button", { name: "Late operations item" }))
      .not.toBeInTheDocument();
    expect(requestedTeams).toContain("team-fin");
  });

  it("creates in the selected team, sends an idempotency key, then refreshes list and dashboard", async () => {
    let created = false;
    const createKeys: string[] = [];
    let dashboardCalls = 0;
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) {
        dashboardCalls += 1;
        return dashboardResponse(dashboardCalls);
      }
      if (listRequest(request)) {
        return jsonResponse({
          data: created ? [listItemResponse("created-item", "Created from UI")] : [],
          meta: { nextCursor: null },
        });
      }
      if (request.url.pathname === "/api/items" && request.method === "POST") {
        created = true;
        createKeys.push(request.headers.get("Idempotency-Key") ?? "");
        expect(request.body).toMatchObject({ title: "Created from UI", teamId: "team-ops" });
        return jsonResponse({
          data: {
            id: "created-item",
            title: "Created from UI",
            description: "",
            type: "TASK",
            priority: "MEDIUM",
            status: "OPEN",
            teamId: "team-ops",
            assigneeId: null,
            createdById: "user-1",
            dueDate: null,
            version: 1,
            createdAt: "2026-10-18T10:00:00.000Z",
            updatedAt: "2026-10-18T10:00:00.000Z",
          },
          replayed: false,
        }, 201);
      }
      return jsonResponse({ data: {} });
    });
    render(<App />);
    const user = await signIn();
    await screen.findByText("No work items match these filters.");
    await user.click(screen.getByText("Create work item", { selector: "summary" }));
    await user.type(screen.getByLabelText("New work-item title"), "Created from UI");
    await user.click(screen.getByRole("button", { name: /^Create work item$/ }));

    expect(await screen.findByText("“Created from UI” was created successfully."))
      .toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Created from UI" }))
      .toBeInTheDocument();
    expect(createKeys[0]).toBeTruthy();
    expect(dashboardCalls).toBeGreaterThan(1);
  });

  it("validates creation and reuses the operation key after an uncertain 409", async () => {
    let postCount = 0;
    const keys: string[] = [];
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) return dashboardResponse();
      if (listRequest(request)) return jsonResponse({ data: [], meta: { nextCursor: null } });
      if (request.url.pathname === "/api/items" && request.method === "POST") {
        postCount += 1;
        keys.push(request.headers.get("Idempotency-Key") ?? "");
        return postCount === 1
          ? apiError(409, "REQUEST_IN_PROGRESS", "Pending")
          : jsonResponse({
              data: {
                id: "retried",
                title: "Retry this title",
                description: "",
                type: "TASK",
                priority: "MEDIUM",
                status: "OPEN",
                teamId: "team-ops",
                assigneeId: null,
                createdById: "user-1",
                dueDate: null,
                version: 1,
                createdAt: "2026-10-18T10:00:00.000Z",
                updatedAt: "2026-10-18T10:00:00.000Z",
              },
              replayed: true,
            }, 201);
      }
      return jsonResponse({ data: {} });
    });
    render(<App />);
    const user = await signIn();
    await user.click(screen.getByText("Create work item", { selector: "summary" }));
    const titleInput = screen.getByLabelText("New work-item title");
    await user.type(titleInput, "   ");
    await user.click(screen.getByRole("button", { name: /^Create work item$/ }));
    expect(await screen.findByText("Enter a title for the work item.")).toBeInTheDocument();
    expect(postCount).toBe(0);

    await user.clear(titleInput);
    await user.type(titleInput, "Retry this title");
    await user.click(screen.getByRole("button", { name: /^Create work item$/ }));
    expect(await screen.findByText(/still processing/)).toBeInTheDocument();
    expect(screen.getByLabelText("New work-item title")).toHaveValue("Retry this title");
    await user.click(screen.getByRole("button", { name: /^Create work item$/ }));
    expect(await screen.findByText("“Retry this title” was created successfully."))
      .toBeInTheDocument();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("shows a safe server validation error while preserving creation input", async () => {
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) return dashboardResponse();
      if (listRequest(request)) return jsonResponse({ data: [], meta: { nextCursor: null } });
      if (request.url.pathname === "/api/items" && request.method === "POST") {
        return apiError(400, "VALIDATION_ERROR", "Invalid due date");
      }
      return jsonResponse({ data: {} });
    });
    render(<App />);
    const user = await signIn();
    await user.click(screen.getByText("Create work item", { selector: "summary" }));
    const title = screen.getByLabelText("New work-item title");
    await user.type(title, "Keep this new item");
    await user.click(screen.getByRole("button", { name: /^Create work item$/ }));

    expect(await screen.findByText("Check the work-item details: Invalid due date"))
      .toBeInTheDocument();
    expect(title).toHaveValue("Keep this new item");
  });
});

describe("details, mutations, comments, and activity", () => {
  it("does not overwrite edits on a 409 and reloads the latest work-item version", async () => {
    let detailsCalls = 0;
    let patchBody: unknown;
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) return dashboardResponse();
      if (listRequest(request)) return jsonResponse({
        data: [listItemResponse("edit-item", "Original title")],
        meta: { nextCursor: null },
      });
      if (request.url.pathname === "/api/items/edit-item" && request.method === "GET") {
        detailsCalls += 1;
        return jsonResponse({
          data: item("edit-item", detailsCalls > 1 ? "New server title" : "Original title", "team-ops", { version: detailsCalls }),
        });
      }
      if (request.url.pathname === "/api/items/edit-item" && request.method === "PATCH") {
        patchBody = request.body;
        return apiError(409, "VERSION_CONFLICT", "Stale version");
      }
      if (request.url.pathname.endsWith("/activity")) return jsonResponse({ data: [], meta: { nextCursor: null } });
      if (request.url.pathname.endsWith("/comments")) return jsonResponse({ data: [] });
      return jsonResponse({ data: {} });
    });
    render(<App />);
    const user = await signIn();
    await user.click(await screen.findByRole("button", { name: "Original title" }));
    await screen.findByRole("heading", { name: "Work-item details" });
    await user.clear(screen.getByLabelText("Work-item title"));
    await user.type(screen.getByLabelText("Work-item title"), "My competing edit");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/Your edits were not saved/)).toBeInTheDocument();
    expect(patchBody).toMatchObject({ version: 1, title: "My competing edit" });
    await user.click(screen.getByRole("button", { name: "Reload latest version" }));
    expect(await screen.findByDisplayValue("New server title")).toBeInTheDocument();
    expect(detailsCalls).toBe(2);
  });

  it("claims an eligible item and sends the current version for workflow transitions", async () => {
    let detail: WorkItemDetails = item("claim-item", "Claimable item");
    let transitionBody: unknown;
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) return dashboardResponse();
      if (listRequest(request)) return jsonResponse({
        data: [listItemResponse(detail.id, detail.title)],
        meta: { nextCursor: null },
      });
      if (request.url.pathname === `/api/items/${detail.id}` && request.method === "GET") {
        return jsonResponse({ data: detail });
      }
      if (request.url.pathname.endsWith("/claim")) {
        detail = {
          ...detail,
          assigneeId: "user-1",
          assignee: { id: "user-1", name: "Morgan Member", email: member.email },
          version: 2,
        };
        return jsonResponse({ data: detail });
      }
      if (request.url.pathname.endsWith("/transition")) {
        transitionBody = request.body;
        detail = { ...detail, status: "IN_PROGRESS", version: 3 };
        return jsonResponse({ data: detail });
      }
      if (request.url.pathname.endsWith("/activity")) return jsonResponse({ data: [], meta: { nextCursor: null } });
      if (request.url.pathname.endsWith("/comments")) return jsonResponse({ data: [] });
      return jsonResponse({ data: {} });
    });
    render(<App />);
    const user = await signIn();
    await user.click(await screen.findByRole("button", { name: "Claimable item" }));
    await user.click(await screen.findByRole("button", { name: "Claim this work item" }));
    expect(await screen.findByText("Work item claimed successfully.")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Move to IN PROGRESS" }));
    expect(await screen.findByText("Work item moved to IN PROGRESS.")).toBeInTheDocument();
    expect(transitionBody).toMatchObject({ status: "IN_PROGRESS", version: 2 });
  });

  it("retries missing details and safely handles claim conflicts and rejected transitions", async () => {
    let detailCalls = 0;
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) return dashboardResponse();
      if (listRequest(request)) return jsonResponse({
        data: [listItemResponse("conflict-item", "Conflict item")],
        meta: { nextCursor: null },
      });
      if (request.url.pathname === "/api/items/conflict-item" && request.method === "GET") {
        detailCalls += 1;
        return detailCalls === 1
          ? apiError(404, "NOT_FOUND", "Work item not found")
          : jsonResponse({ data: item("conflict-item", "Conflict item") });
      }
      if (request.url.pathname.endsWith("/claim")) {
        return apiError(409, "CLAIM_CONFLICT", "Already claimed");
      }
      if (request.url.pathname.endsWith("/transition")) {
        return apiError(422, "INVALID_TRANSITION", "Transition is not allowed");
      }
      if (request.url.pathname.endsWith("/activity")) return jsonResponse({ data: [], meta: { nextCursor: null } });
      if (request.url.pathname.endsWith("/comments")) return jsonResponse({ data: [] });
      return jsonResponse({ data: {} });
    });
    render(<App />);
    const user = await signIn();
    await user.click(await screen.findByRole("button", { name: "Conflict item" }));
    expect(await screen.findByText("Work item not found")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("heading", { name: "Work-item details" });

    await user.click(screen.getByRole("button", { name: "Claim this work item" }));
    expect(await screen.findByText(/claimed or became ineligible/)).toBeInTheDocument();
    await screen.findByRole("button", { name: "Move to IN PROGRESS" });
    await user.click(screen.getByRole("button", { name: "Move to IN PROGRESS" }));
    expect(await screen.findByText(/no longer allowed for the work item’s current status/))
      .toBeInTheDocument();
    expect(detailCalls).toBeGreaterThanOrEqual(3);
  });

  it("hides item write actions from a VIEWER", async () => {
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse(viewer);
      if (dashboardRequest(request)) return dashboardResponse();
      if (listRequest(request)) return jsonResponse({
        data: [listItemResponse("viewer-item", "Viewer item")],
        meta: { nextCursor: null },
      });
      if (request.url.pathname.endsWith("/items/viewer-item")) {
        return jsonResponse({ data: item("viewer-item", "Viewer item") });
      }
      if (request.url.pathname.endsWith("/activity")) return jsonResponse({ data: [], meta: { nextCursor: null } });
      if (request.url.pathname.endsWith("/comments")) return jsonResponse({ data: [] });
      return jsonResponse({ data: {} });
    });
    render(<App />);
    const user = await signIn(viewer);
    await user.click(await screen.findByRole("button", { name: "Viewer item" }));
    expect(await screen.findByText("Your role in this team allows viewing but not editing this item."))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Claim this work item" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move to IN PROGRESS" }))
      .not.toBeInTheDocument();
    expect(screen.getByText("Your role in this team allows viewing but not adding comments."))
      .toBeInTheDocument();
  });

  it("refreshes activity after a successful comment and clears the input", async () => {
    let comments: ReturnType<typeof comment>[] = [];
    let events: ReturnType<typeof activityEvent>[] = [];
    let activityRequests = 0;
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) return dashboardResponse();
      if (listRequest(request)) return jsonResponse({
        data: [listItemResponse("comment-item", "Comment item")],
        meta: { nextCursor: null },
      });
      if (request.url.pathname.endsWith("/items/comment-item")) {
        return jsonResponse({ data: item("comment-item", "Comment item") });
      }
      if (request.url.pathname.endsWith("/activity")) {
        activityRequests += 1;
        return jsonResponse({ data: events, meta: { nextCursor: null } });
      }
      if (request.url.pathname.endsWith("/comments") && request.method === "GET") {
        return jsonResponse({ data: comments });
      }
      if (request.url.pathname.endsWith("/comments") && request.method === "POST") {
        const created = comment(
          "comment-1",
          "comment-item",
          (request.body as { body: string }).body,
        );
        comments = [created];
        events = [activityEvent("event-comment", "comment-item", "COMMENTED", created.id)];
        return jsonResponse({ data: created }, 201);
      }
      return jsonResponse({ data: {} });
    });
    render(<App />);
    const user = await signIn();
    await user.click(await screen.findByRole("button", { name: "Comment item" }));
    await screen.findByText("No comments yet.");
    const initialActivityRequests = activityRequests;
    await user.type(screen.getByLabelText("Add a comment"), "Checking activity update");
    await user.click(screen.getByRole("button", { name: "Add comment" }));

    expect(await screen.findByText("Checking activity update", { exact: true }))
      .toBeInTheDocument();
    expect(await screen.findByText("COMMENTED")).toBeInTheDocument();
    expect(screen.getByLabelText("Add a comment")).toHaveValue("");
    expect(activityRequests).toBeGreaterThan(initialActivityRequests);
  });

  it("preserves comment text after a failed submit and permits a retry", async () => {
    let posts = 0;
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) return dashboardResponse();
      if (listRequest(request)) return jsonResponse({
        data: [listItemResponse("failure-item", "Failure item")],
        meta: { nextCursor: null },
      });
      if (request.url.pathname.endsWith("/items/failure-item")) {
        return jsonResponse({ data: item("failure-item", "Failure item") });
      }
      if (request.url.pathname.endsWith("/activity")) return jsonResponse({ data: [], meta: { nextCursor: null } });
      if (request.url.pathname.endsWith("/comments") && request.method === "GET") {
        return jsonResponse({ data: [] });
      }
      if (request.url.pathname.endsWith("/comments") && request.method === "POST") {
        posts += 1;
        return posts === 1
          ? apiError(403, "FORBIDDEN", "Forbidden")
          : jsonResponse({
              data: comment("comment-retried", "failure-item", "Keep this text"),
            }, 201);
      }
      return jsonResponse({ data: {} });
    });
    render(<App />);
    const user = await signIn();
    await user.click(await screen.findByRole("button", { name: "Failure item" }));
    await user.type(await screen.findByLabelText("Add a comment"), "Keep this text");
    await user.click(screen.getByRole("button", { name: "Add comment" }));
    expect(await screen.findByText("Your role in this team does not allow commenting."))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Add a comment")).toHaveValue("Keep this text");
    await user.click(screen.getByRole("button", { name: "Add comment" }));
    expect(await screen.findByText("Comment added.")).toBeInTheDocument();
    expect(posts).toBe(2);
  });

  it("prevents duplicate comment submissions while the request is pending", async () => {
    let resolvePost!: (response: Response) => void;
    let posts = 0;
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) return dashboardResponse();
      if (listRequest(request)) return jsonResponse({
        data: [listItemResponse("pending-item", "Pending item")],
        meta: { nextCursor: null },
      });
      if (request.url.pathname.endsWith("/items/pending-item")) {
        return jsonResponse({ data: item("pending-item", "Pending item") });
      }
      if (request.url.pathname.endsWith("/activity")) {
        return jsonResponse({ data: [], meta: { nextCursor: null } });
      }
      if (request.url.pathname.endsWith("/comments") && request.method === "GET") {
        return jsonResponse({ data: [] });
      }
      if (request.url.pathname.endsWith("/comments") && request.method === "POST") {
        posts += 1;
        return new Promise<Response>((resolve) => {
          resolvePost = resolve;
        });
      }
      return jsonResponse({ data: {} });
    });
    render(<App />);
    const user = await signIn();
    await user.click(await screen.findByRole("button", { name: "Pending item" }));
    await user.type(await screen.findByLabelText("Add a comment"), "One submission");
    await user.click(screen.getByRole("button", { name: "Add comment" }));
    const pendingButton = await screen.findByRole("button", { name: "Adding comment…" });
    expect(pendingButton).toBeDisabled();
    await user.click(pendingButton);
    expect(posts).toBe(1);
    resolvePost(jsonResponse({
      data: comment("pending-comment", "pending-item", "One submission"),
    }, 201));
    expect(await screen.findByText("Comment added.")).toBeInTheDocument();
    expect(posts).toBe(1);
  });

  it("retains loaded activity when a cursor request fails and deduplicates retry results", async () => {
    let continuationCalls = 0;
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) return dashboardResponse();
      if (listRequest(request)) return jsonResponse({
        data: [listItemResponse("activity-item", "Activity item")],
        meta: { nextCursor: null },
      });
      if (request.url.pathname.endsWith("/items/activity-item")) {
        return jsonResponse({ data: item("activity-item", "Activity item") });
      }
      if (request.url.pathname.endsWith("/activity")) {
        if (!request.url.searchParams.has("cursor")) {
          return jsonResponse({
            data: [activityEvent("first-event", "activity-item", "CREATED", "Activity item")],
            meta: { nextCursor: "first-event" },
          });
        }
        continuationCalls += 1;
        if (continuationCalls === 1) {
          return apiError(500, "INTERNAL_ERROR", "More activity failed");
        }
        return jsonResponse({
          data: [
            activityEvent("first-event", "activity-item", "CREATED", "Activity item"),
            activityEvent("second-event", "activity-item", "COMMENTED", "comment-1"),
          ],
          meta: { nextCursor: null },
        });
      }
      if (request.url.pathname.endsWith("/comments")) return jsonResponse({ data: [] });
      return jsonResponse({ data: {} });
    });
    render(<App />);
    const user = await signIn();
    await user.click(await screen.findByRole("button", { name: "Activity item" }));
    expect(await screen.findByText("CREATED")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more activity" }));
    expect(await screen.findByText("More activity failed")).toBeInTheDocument();
    expect(screen.getByText("CREATED")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry loading activity" }));
    expect(await screen.findByText("COMMENTED")).toBeInTheDocument();
    expect(screen.getAllByText("CREATED")).toHaveLength(1);
  });

  it("shows only the selected item’s comments and activity after switching details", async () => {
    const requests: string[] = [];
    mockApi((request) => {
      if (request.url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", message: "API ready" });
      }
      if (loginRequest(request)) return loginResponse();
      if (dashboardRequest(request)) return dashboardResponse();
      if (listRequest(request)) return jsonResponse({
        data: [
          listItemResponse("switch-one", "First item"),
          listItemResponse("switch-two", "Second item"),
        ],
        meta: { nextCursor: null },
      });
      const itemId = request.url.pathname.includes("switch-one")
        ? "switch-one"
        : "switch-two";
      if (request.url.pathname.endsWith(`/items/${itemId}`)) {
        return jsonResponse({ data: item(itemId, itemId === "switch-one" ? "First item" : "Second item") });
      }
      if (request.url.pathname.endsWith("/activity")) {
        requests.push(`${itemId}:activity`);
        return jsonResponse({
          data: [activityEvent(`${itemId}-event`, itemId, "CREATED", itemId)],
          meta: { nextCursor: null },
        });
      }
      if (request.url.pathname.endsWith("/comments")) {
        requests.push(`${itemId}:comments`);
        return jsonResponse({
          data: [comment(`${itemId}-comment`, itemId, `${itemId} comment`)],
        });
      }
      return jsonResponse({ data: {} });
    });
    render(<App />);
    const user = await signIn();
    await user.click(await screen.findByRole("button", { name: "First item" }));
    expect(await screen.findByText("switch-one comment")).toBeInTheDocument();
    expect(await screen.findByText("switch-one")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to list" }));
    await user.click(screen.getByRole("button", { name: "Second item" }));

    expect(await screen.findByText("switch-two comment")).toBeInTheDocument();
    expect(await screen.findByText("switch-two")).toBeInTheDocument();
    expect(screen.queryByText("switch-one comment")).not.toBeInTheDocument();
    expect(requests).toContain("switch-two:activity");
    expect(requests).toContain("switch-two:comments");
  });
});
