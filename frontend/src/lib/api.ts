function resolveApiBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_API_URL || "http://localhost:5001/api";
  let url: URL;

  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("VITE_API_URL must be an absolute HTTP or HTTPS URL.");
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const sameOrigin =
    typeof window !== "undefined" && url.origin === window.location.origin;
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && (localHosts.has(url.hostname) || sameOrigin))) ||
    url.username ||
    url.password
  ) {
    throw new Error("VITE_API_URL must use HTTPS or a trusted local HTTP origin.");
  }

  return url.toString().replace(/\/+$/, "");
}

const apiBaseUrl = resolveApiBaseUrl();

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH";
  token?: string;
  idempotencyKey?: string;
  body?: unknown;
  signal?: AbortSignal;
  onUnauthorized?: () => void;
}

export type AuthenticatedApiRequestOptions = Omit<
  ApiRequestOptions,
  "token" | "onUnauthorized"
>;

interface ApiErrorResponse {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(
    message: string,
    status: number,
    code: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  get requiresAuthentication(): boolean {
    return this.status === 401;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function apiRequest(
  path: string,
  options: ApiRequestOptions = {},
): Promise<unknown> {
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    credentials: "omit",
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) {
      throw new ApiError("The backend returned an invalid response.", response.status, "INVALID_RESPONSE");
    }
    throw new ApiError(`The backend request failed (${response.status}).`, response.status, "HTTP_ERROR");
  }

  if (!response.ok) {
    if (response.status === 401 && options.token) {
      options.onUnauthorized?.();
    }
    const error = isRecord(payload) ? (payload as ApiErrorResponse).error : undefined;
    const message =
      typeof error?.message === "string"
        ? error.message
        : `The backend request failed (${response.status}).`;
    const code = typeof error?.code === "string" ? error.code : "HTTP_ERROR";
    throw new ApiError(message, response.status, code);
  }

  return payload;
}

export interface BackendHealth {
  status: "ok";
  message: string;
}

export async function getBackendHealth(
  signal?: AbortSignal,
): Promise<BackendHealth> {
  const payload = await apiRequest("/health", { signal });
  if (
    !isRecord(payload) ||
    payload.status !== "ok" ||
    typeof payload.message !== "string"
  ) {
    throw new ApiError("The backend returned an unexpected health response.", 200, "INVALID_RESPONSE");
  }
  return { status: "ok", message: payload.message };
}

export type TeamRole = "VIEWER" | "MEMBER" | "LEAD" | "ADMIN";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  memberships: Array<{
    role: TeamRole;
    team: { id: string; name: string; slug: string };
  }>;
}

export interface LoginResult {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: string;
  user: AuthenticatedUser;
}

export type WorkItemStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "AWAITING_APPROVAL"
  | "RESOLVED"
  | "CLOSED";

export type WorkItemPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type WorkItemType =
  | "INCIDENT"
  | "CUSTOMER_ISSUE"
  | "PAYMENT"
  | "COMPLIANCE"
  | "TASK";

export interface CreateWorkItemInput {
  title: string;
  description: string;
  type: WorkItemType;
  priority: WorkItemPriority;
  teamId: string;
  dueDate?: string;
}

export interface CreatedWorkItem {
  id: string;
  title: string;
  description: string;
  type: WorkItemType;
  priority: WorkItemPriority;
  status: WorkItemStatus;
  teamId: string;
  assigneeId: string | null;
  createdById: string;
  dueDate: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkItemDetails extends CreatedWorkItem {
  team: { id: string; name: string; slug: string };
  assignee: { id: string; name: string; email: string } | null;
  createdBy: { id: string; name: string; email: string };
}

export interface UpdateWorkItemInput {
  version: number;
  title?: string;
  description?: string;
  type?: WorkItemType;
  priority?: WorkItemPriority;
  dueDate?: string | null;
}

export interface WorkItem {
  id: string;
  title: string;
  type: WorkItemType;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  dueDate: string | null;
  team: { id: string; name: string; slug: string };
  assignee: { id: string; name: string } | null;
}

export interface WorkItemListQuery {
  teamId: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  search?: string;
  cursor?: string;
  pageSize?: number;
}

export interface WorkItemListPage {
  data: WorkItem[];
  meta: { nextCursor: string | null };
}

function isWorkItemStatus(value: unknown): value is WorkItemStatus {
  return ["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL", "RESOLVED", "CLOSED"].includes(
    String(value),
  );
}

function isWorkItemPriority(value: unknown): value is WorkItemPriority {
  return ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(String(value));
}

function isWorkItemType(value: unknown): value is WorkItemType {
  return ["INCIDENT", "CUSTOMER_ISSUE", "PAYMENT", "COMPLIANCE", "TASK"].includes(
    String(value),
  );
}

function isCreatedWorkItem(value: unknown): value is CreatedWorkItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    isWorkItemType(value.type) &&
    isWorkItemPriority(value.priority) &&
    isWorkItemStatus(value.status) &&
    typeof value.teamId === "string" &&
    (typeof value.assigneeId === "string" || value.assigneeId === null) &&
    typeof value.createdById === "string" &&
    (typeof value.dueDate === "string" || value.dueDate === null) &&
    typeof value.version === "number" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isWorkItemDetails(value: unknown): value is WorkItemDetails {
  if (!isRecord(value)) return false;
  const details = value;
  return (
    isCreatedWorkItem(details) &&
    isRecord(details.team) &&
    typeof details.team.id === "string" &&
    typeof details.team.name === "string" &&
    typeof details.team.slug === "string" &&
    (details.assignee === null ||
      (isRecord(details.assignee) &&
        typeof details.assignee.id === "string" &&
        typeof details.assignee.name === "string" &&
        typeof details.assignee.email === "string")) &&
    isRecord(details.createdBy) &&
    typeof details.createdBy.id === "string" &&
    typeof details.createdBy.name === "string" &&
    typeof details.createdBy.email === "string"
  );
}

export async function createWorkItem(
  request: (
    path: string,
    options?: AuthenticatedApiRequestOptions,
  ) => Promise<unknown>,
  input: CreateWorkItemInput,
  idempotencyKey: string,
): Promise<{ data: CreatedWorkItem; replayed: boolean }> {
  const payload = await request("/items", {
    method: "POST",
    body: input,
    idempotencyKey,
  });

  if (
    !isRecord(payload) ||
    !isCreatedWorkItem(payload.data) ||
    typeof payload.replayed !== "boolean"
  ) {
    throw new ApiError(
      "The backend returned an unexpected work-item creation response.",
      201,
      "INVALID_RESPONSE",
    );
  }

  return { data: payload.data, replayed: payload.replayed };
}

export async function getWorkItemDetails(
  request: (
    path: string,
    options?: AuthenticatedApiRequestOptions,
  ) => Promise<unknown>,
  id: string,
  signal?: AbortSignal,
): Promise<WorkItemDetails> {
  const payload = await request(`/items/${encodeURIComponent(id)}`, { signal });
  if (!isRecord(payload) || !isWorkItemDetails(payload.data)) {
    throw new ApiError(
      "The backend returned an unexpected work-item details response.",
      200,
      "INVALID_RESPONSE",
    );
  }
  return payload.data;
}

export async function updateWorkItem(
  request: (
    path: string,
    options?: AuthenticatedApiRequestOptions,
  ) => Promise<unknown>,
  id: string,
  input: UpdateWorkItemInput,
): Promise<CreatedWorkItem> {
  const payload = await request(`/items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
  if (!isRecord(payload) || !isCreatedWorkItem(payload.data)) {
    throw new ApiError(
      "The backend returned an unexpected work-item update response.",
      200,
      "INVALID_RESPONSE",
    );
  }
  return payload.data;
}

function isWorkItem(value: unknown): value is WorkItem {
  if (!isRecord(value)) return false;
  const validAssignee =
    value.assignee === null ||
    (isRecord(value.assignee) &&
      typeof value.assignee.id === "string" &&
      typeof value.assignee.name === "string");
  const validTeam =
    isRecord(value.team) &&
    typeof value.team.id === "string" &&
    typeof value.team.name === "string" &&
    typeof value.team.slug === "string";
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    isWorkItemType(value.type) &&
    isWorkItemStatus(value.status) &&
    isWorkItemPriority(value.priority) &&
    (value.dueDate === null || typeof value.dueDate === "string") &&
    validTeam &&
    validAssignee
  );
}

export async function listWorkItems(
  request: (
    path: string,
    options?: AuthenticatedApiRequestOptions,
  ) => Promise<unknown>,
  query: WorkItemListQuery,
  signal?: AbortSignal,
): Promise<WorkItemListPage> {
  const params = new URLSearchParams({
    teamId: query.teamId,
    pageSize: String(query.pageSize ?? 25),
  });
  if (query.status) params.set("status", query.status);
  if (query.priority) params.set("priority", query.priority);
  if (query.search?.trim()) params.set("search", query.search.trim());
  if (query.cursor) params.set("cursor", query.cursor);

  const payload = await request(`/items?${params.toString()}`, { signal });
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.data) ||
    !payload.data.every(isWorkItem) ||
    !isRecord(payload.meta) ||
    (payload.meta.nextCursor !== null &&
      typeof payload.meta.nextCursor !== "string")
  ) {
    throw new ApiError(
      "The backend returned an unexpected work-item list response.",
      200,
      "INVALID_RESPONSE",
    );
  }

  return {
    data: payload.data,
    meta: { nextCursor: payload.meta.nextCursor },
  };
}

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.email !== "string" ||
    !Array.isArray(value.memberships)
  ) {
    return false;
  }

  return value.memberships.every(
    (membership) =>
      isRecord(membership) &&
      ["VIEWER", "MEMBER", "LEAD", "ADMIN"].includes(String(membership.role)) &&
      isRecord(membership.team) &&
      typeof membership.team.id === "string" &&
      typeof membership.team.name === "string" &&
      typeof membership.team.slug === "string",
  );
}

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<LoginResult> {
  const payload = await apiRequest("/auth/login", {
    method: "POST",
    body: { email: email.trim(), password },
  });

  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new ApiError("The backend returned an unexpected login response.", 200, "INVALID_RESPONSE");
  }

  const result = payload.data;
  if (
    typeof result.accessToken !== "string" ||
    result.accessToken.length === 0 ||
    result.tokenType !== "Bearer" ||
    typeof result.expiresIn !== "string" ||
    !isAuthenticatedUser(result.user)
  ) {
    throw new ApiError("The backend returned an unexpected login response.", 200, "INVALID_RESPONSE");
  }

  return {
    accessToken: result.accessToken,
    tokenType: "Bearer",
    expiresIn: result.expiresIn,
    user: result.user,
  };
}
