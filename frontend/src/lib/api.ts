const apiBaseUrl = (import.meta.env.VITE_API_URL || "http://localhost:5001/api").replace(
  /\/+$/,
  "",
);

interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH";
  token?: string;
  idempotencyKey?: string;
  body?: unknown;
  signal?: AbortSignal;
}

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

async function request(
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
  const payload = await request("/health", { signal });
  if (
    !isRecord(payload) ||
    payload.status !== "ok" ||
    typeof payload.message !== "string"
  ) {
    throw new ApiError("The backend returned an unexpected health response.", 200, "INVALID_RESPONSE");
  }
  return { status: "ok", message: payload.message };
}
