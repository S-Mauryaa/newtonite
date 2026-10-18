import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthProvider } from "./auth/AuthProvider";
import { useAuth } from "./auth/useAuth";
import {
  ApiError,
  claimWorkItem,
  createWorkItem,
  createWorkItemComment,
  getBackendHealth,
  getWorkItemDashboard,
  getWorkItemDetails,
  listWorkItems,
  listWorkItemActivity,
  listWorkItemComments,
  updateWorkItem,
  transitionWorkItem,
  type WorkItemActivityEvent,
  type WorkItemComment,
  type WorkItemDashboard,
  type WorkItemType,
  type WorkItemDetails,
  type WorkItem,
  type WorkItemPriority,
  type WorkItemStatus,
  type UpdateWorkItemInput,
  type TeamRole,
} from "./lib/api";
import "./App.css";

function BackendStatus() {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "connected"; message: string }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    getBackendHealth(controller.signal)
      .then((health) => {
        setState({ status: "connected", message: health.message });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to connect to the backend.",
        });
      });

    return () => controller.abort();
  }, [retry]);

  return (
    <div className="backend-status" aria-live="polite">
      <span
        className={`backend-status__indicator backend-status__indicator--${state.status}`}
        aria-hidden="true"
      />
      <div>
        <strong>Backend</strong>
        <p>
          {state.status === "loading" && "Checking connection…"}
          {state.status === "connected" && state.message}
          {state.status === "error" && state.message}
        </p>
      </div>
      {state.status === "error" && (
        <button
          className="backend-status__retry"
          type="button"
          onClick={() => {
            setState({ status: "loading" });
            setRetry((current) => current + 1);
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

function LoginForm() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInProgress = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInProgress.current) return;

    submissionInProgress.current = true;
    setError("");
    setIsSubmitting(true);
    try {
      await login(email, password);
      setPassword("");
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        setError("Email or password is incorrect.");
      } else if (
        requestError instanceof ApiError &&
        requestError.status === 400
      ) {
        setError("Enter a valid email address and password.");
      } else {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to sign in. Please try again.",
        );
      }
    } finally {
      setPassword("");
      submissionInProgress.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="login-title">
      <div className="auth-card__eyebrow">NEWTONITE OPS</div>
      <h1 id="login-title">Welcome back</h1>
      <p className="auth-card__description">
        Sign in with your Newtonite account to continue.
      </p>

      <form className="login-form" onSubmit={handleSubmit}>
        <label htmlFor="email">Email</label>
        <input
          autoComplete="username"
          autoFocus
          id="email"
          maxLength={320}
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />

        <label htmlFor="password">Password</label>
        <input
          autoComplete="current-password"
          id="password"
          maxLength={200}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />

        {error && (
          <p className="login-form__error" role="alert">
            {error}
          </p>
        )}

        <button
          className="login-form__submit"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="auth-card__footnote">
        Your sign-in lasts for this page session. Refreshing the page signs you
        out.
      </p>
    </section>
  );
}

interface WorkItemListState {
  teamId: string;
  filtersKey: string;
  items: WorkItem[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

function CreateWorkItemForm({
  teamId,
  role,
  onCreated,
  onSubmittingChange,
}: {
  teamId: string;
  role: TeamRole | undefined;
  onCreated: () => void;
  onSubmittingChange: (submitting: boolean) => void;
}) {
  const { authenticatedRequest } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<WorkItemType>("TASK");
  const [priority, setPriority] = useState<WorkItemPriority>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false);
  const pendingOperation = useRef<{ key: string; body: string } | null>(null);
  const canCreate = role !== undefined && role !== "VIEWER";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError("Enter a title for the work item.");
      setSuccess("");
      return;
    }
    if (normalizedTitle.length > 200) {
      setError("The title must be 200 characters or fewer.");
      setSuccess("");
      return;
    }
    if (description.length > 10000) {
      setError("The description must be 10,000 characters or fewer.");
      setSuccess("");
      return;
    }
    if (!teamId || !canCreate) {
      setError("Your selected team role does not allow creating work items.");
      setSuccess("");
      return;
    }

    const parsedDueDate = dueDate
      ? new Date(`${dueDate}T00:00:00.000Z`)
      : undefined;
    if (parsedDueDate && Number.isNaN(parsedDueDate.getTime())) {
      setError("Enter a valid due date.");
      setSuccess("");
      return;
    }

    const input = {
      title: normalizedTitle,
      description,
      type,
      priority,
      teamId,
      ...(parsedDueDate
        ? { dueDate: parsedDueDate.toISOString() }
        : {}),
    };
    const serializedBody = JSON.stringify(input);
    if (pendingOperation.current?.body !== serializedBody) {
      pendingOperation.current = {
        key: crypto.randomUUID(),
        body: serializedBody,
      };
    }

    submitting.current = true;
    setIsSubmitting(true);
    onSubmittingChange(true);
    setError("");
    setSuccess("");
    try {
      const result = await createWorkItem(
        authenticatedRequest,
        input,
        pendingOperation.current.key,
      );
      pendingOperation.current = null;
      setTitle("");
      setDescription("");
      setType("TASK");
      setPriority("MEDIUM");
      setDueDate("");
      setSuccess(`“${result.data.title}” was created successfully.`);
      onCreated();
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 409) {
        setError(
          requestError.code === "REQUEST_IN_PROGRESS"
            ? "This creation request is still processing. Retry without changing the form."
            : requestError.code === "IDEMPOTENCY_KEY_REUSED"
              ? "The request key conflicts with a previous submission. Change a field before submitting again."
              : requestError.message,
        );
      } else if (requestError instanceof ApiError && requestError.status === 400) {
        setError(`Check the work-item details: ${requestError.message}`);
      } else if (requestError instanceof ApiError && requestError.status === 403) {
        setError("Your role in this team does not allow creating work items.");
      } else if (requestError instanceof ApiError && requestError.status === 404) {
        setError("Your access to this team changed. Select an available team and retry.");
      } else {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to create the work item. Retry with the same details.",
        );
      }
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
      onSubmittingChange(false);
    }
  }

  return (
    <details className="create-work-item">
      <summary>Create work item</summary>
      {!canCreate ? (
        <p className="create-work-item__notice" role="status">
          Your role in this team does not allow creating work items. Choose a team
          where you have a member, lead, or admin role.
        </p>
      ) : (
        <form className="create-work-item__form" onSubmit={handleSubmit}>
          <p className="create-work-item__team">
            Creating in the selected team. New work items start with OPEN status.
          </p>
          <label>
            <span>Title</span>
            <input
              aria-label="New work-item title"
              autoComplete="off"
              disabled={isSubmitting}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </label>
          <label>
            <span>Description</span>
            <textarea
              aria-label="New work-item description"
              disabled={isSubmitting}
              maxLength={10000}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              value={description}
            />
          </label>
          <div className="create-work-item__options">
            <label>
              <span>Type</span>
              <select
                aria-label="New work-item type"
                disabled={isSubmitting}
                onChange={(event) => setType(event.target.value as WorkItemType)}
                value={type}
              >
                <option value="INCIDENT">Incident</option>
                <option value="CUSTOMER_ISSUE">Customer issue</option>
                <option value="PAYMENT">Payment</option>
                <option value="COMPLIANCE">Compliance</option>
                <option value="TASK">Task</option>
              </select>
            </label>
            <label>
              <span>Priority</span>
              <select
                aria-label="New work-item priority"
                disabled={isSubmitting}
                onChange={(event) =>
                  setPriority(event.target.value as WorkItemPriority)
                }
                value={priority}
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </label>
            <label>
              <span>Due date</span>
              <input
                aria-label="New work-item due date"
                disabled={isSubmitting}
                onChange={(event) => setDueDate(event.target.value)}
                type="date"
                value={dueDate}
              />
            </label>
          </div>
          {error && (
            <p className="create-work-item__error" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="create-work-item__success" role="status">
              {success}
            </p>
          )}
          <button
            className="work-items__filter-button"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Creating…" : "Create work item"}
          </button>
        </form>
      )}
    </details>
  );
}

interface WorkItemDraft {
  title: string;
  description: string;
  type: WorkItemType;
  priority: WorkItemPriority;
  dueDate: string;
}

function draftFromWorkItem(item: WorkItemDetails): WorkItemDraft {
  return {
    title: item.title,
    description: item.description,
    type: item.type,
    priority: item.priority,
    dueDate: item.dueDate?.slice(0, 10) ?? "",
  };
}

function availableTransitions(
  status: WorkItemStatus,
  role: TeamRole | undefined,
): WorkItemStatus[] {
  if (role === undefined || role === "VIEWER") return [];
  const transitions: Record<WorkItemStatus, WorkItemStatus[]> = {
    OPEN: ["IN_PROGRESS"],
    IN_PROGRESS: ["OPEN", "AWAITING_APPROVAL"],
    AWAITING_APPROVAL: [
      "IN_PROGRESS",
      ...(role === "LEAD" || role === "ADMIN" ? ["RESOLVED" as const] : []),
    ],
    RESOLVED: ["IN_PROGRESS", "CLOSED"],
    CLOSED: [],
  };
  return transitions[status];
}

interface ActivityTimelineState {
  events: WorkItemActivityEvent[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMoreError: string | null;
}

interface WorkItemCommentsState {
  comments: WorkItemComment[];
  loading: boolean;
  error: string | null;
}

function WorkItemComments({
  itemId,
  canComment,
  onCommentAdded,
}: {
  itemId: string;
  canComment: boolean;
  onCommentAdded: () => void;
}) {
  const { authenticatedRequest } = useAuth();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<WorkItemCommentsState>({
    comments: [],
    loading: true,
    error: null,
  });
  const [body, setBody] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    listWorkItemComments(
      authenticatedRequest,
      itemId,
      controller.signal,
    )
      .then((comments) => {
        setState({ comments, loading: false, error: null });
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          ...current,
          loading: false,
          error:
            requestError instanceof Error
              ? requestError.message
              : "Unable to load comments. Please try again.",
        }));
      });
    return () => controller.abort();
  }, [authenticatedRequest, itemId, retry]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !canComment) return;

    const normalizedBody = body.trim();
    if (!normalizedBody) {
      setSubmitError("Enter a comment before submitting.");
      setSuccess("");
      return;
    }
    if (normalizedBody.length > 5000) {
      setSubmitError("Comments must be 5,000 characters or fewer.");
      setSuccess("");
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);
    setSubmitError("");
    setSuccess("");
    try {
      await createWorkItemComment(
        authenticatedRequest,
        itemId,
        normalizedBody,
      );
      onCommentAdded();
      setBody("");
      setSuccess("Comment added.");
      setState((current) => ({ ...current, loading: true, error: null }));
      setRetry((value) => value + 1);
    } catch (requestError) {
      if (
        requestError instanceof ApiError &&
        requestError.code === "FORBIDDEN"
      ) {
        setSubmitError("Your role in this team does not allow commenting.");
      } else if (
        requestError instanceof ApiError &&
        requestError.code === "NOT_FOUND"
      ) {
        setSubmitError("This work item is no longer available to your team.");
      } else if (
        requestError instanceof ApiError &&
        requestError.code === "VALIDATION_ERROR"
      ) {
        setSubmitError(`Check your comment: ${requestError.message}`);
      } else {
        setSubmitError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to add the comment. Please try again.",
        );
      }
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <section className="work-item-comments" aria-labelledby="work-item-comments-title">
      <h3 id="work-item-comments-title">Comments</h3>
      {state.loading && (
        <p className="work-items__message" role="status">
          Loading comments…
        </p>
      )}
      {state.error && (
        <div className="work-items__message work-items__message--error" role="alert">
          <p>{state.error}</p>
          <button
            className="work-items__retry"
            onClick={() => {
              setState((current) => ({
                ...current,
                loading: true,
                error: null,
              }));
              setRetry((value) => value + 1);
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      )}
      {!state.loading && !state.error && state.comments.length === 0 && (
        <p className="work-item-comments__empty" role="status">
          No comments yet.
        </p>
      )}
      {state.comments.length > 0 && (
        <ol className="work-item-comments__list">
          {state.comments.map((comment) => (
            <li className="work-item-comments__entry" key={comment.id}>
              <div className="work-item-comments__entry-heading">
                <strong>{comment.author.name}</strong>
                <time dateTime={comment.createdAt}>
                  {new Date(comment.createdAt).toLocaleString()}
                </time>
              </div>
              <p>{comment.body}</p>
            </li>
          ))}
        </ol>
      )}
      {success && (
        <p className="create-work-item__success" role="status">
          {success}
        </p>
      )}
      {canComment ? (
        <form className="work-item-comments__form" onSubmit={handleSubmit}>
          <label htmlFor={`comment-${itemId}`}>Add a comment</label>
          <textarea
            id={`comment-${itemId}`}
            maxLength={5000}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            value={body}
          />
          {submitError && (
            <p className="create-work-item__error" role="alert">
              {submitError}
            </p>
          )}
          <button
            className="work-items__filter-button"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Adding comment…" : "Add comment"}
          </button>
        </form>
      ) : (
        <p className="work-item-comments__readonly" role="status">
          Your role in this team allows viewing but not adding comments.
        </p>
      )}
    </section>
  );
}

function WorkItemActivityTimeline({ itemId }: { itemId: string }) {
  const { authenticatedRequest } = useAuth();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<ActivityTimelineState>({
    events: [],
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: null,
    loadMoreError: null,
  });
  const loadingMore = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    listWorkItemActivity(
      authenticatedRequest,
      itemId,
      {},
      controller.signal,
    )
      .then((page) => {
        setState({
          events: page.data,
          nextCursor: page.meta.nextCursor,
          loading: false,
          loadingMore: false,
          error: null,
          loadMoreError: null,
        });
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          ...current,
          loading: false,
          error:
            requestError instanceof Error
              ? requestError.message
              : "Unable to load activity. Please try again.",
        }));
      });
    return () => controller.abort();
  }, [authenticatedRequest, itemId, retry]);

  async function loadMore() {
    const cursor = state.nextCursor;
    if (!cursor || loadingMore.current) return;

    loadingMore.current = true;
    setState((current) => ({
      ...current,
      loadingMore: true,
      loadMoreError: null,
    }));
    try {
      const page = await listWorkItemActivity(
        authenticatedRequest,
        itemId,
        { cursor },
      );
      setState((current) => {
        const existingIds = new Set(current.events.map((event) => event.id));
        const newEvents = page.data.filter((event) => {
          if (existingIds.has(event.id)) return false;
          existingIds.add(event.id);
          return true;
        });
        return {
          ...current,
          events: [...current.events, ...newEvents],
          nextCursor: page.meta.nextCursor,
          loadingMore: false,
          loadMoreError: null,
        };
      });
    } catch (requestError) {
      setState((current) => ({
        ...current,
        loadingMore: false,
        loadMoreError:
          requestError instanceof Error
            ? requestError.message
            : "Unable to load more activity. Please try again.",
      }));
    } finally {
      loadingMore.current = false;
    }
  }

  return (
    <section className="work-item-activity" aria-labelledby="work-item-activity-title">
      <h3 id="work-item-activity-title">Activity</h3>
      {state.loading && (
        <p className="work-items__message" role="status">
          Loading activity…
        </p>
      )}
      {state.error && (
        <div className="work-items__message work-items__message--error" role="alert">
          <p>{state.error}</p>
          <button
            className="work-items__retry"
            onClick={() => {
              setState((current) => ({
                ...current,
                loading: true,
                error: null,
              }));
              setRetry((value) => value + 1);
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      )}
      {!state.loading && !state.error && state.events.length === 0 && (
        <p className="work-item-activity__empty" role="status">
          No activity has been recorded for this item.
        </p>
      )}
      {state.events.length > 0 && (
        <ol className="work-item-activity__list">
          {state.events.map((event) => {
            const metadataField =
              event.metadata !== null &&
              typeof event.metadata === "object" &&
              !Array.isArray(event.metadata) &&
              typeof event.metadata.field === "string"
                ? event.metadata.field
                : null;
            return (
              <li className="work-item-activity__event" key={event.id}>
                <div className="work-item-activity__event-heading">
                  <strong>{event.action.replaceAll("_", " ")}</strong>
                  <time dateTime={event.createdAt}>
                    {new Date(event.createdAt).toLocaleString()}
                  </time>
                </div>
                <p className="work-item-activity__actor">
                  {event.actor.name}
                  {metadataField ? ` · ${metadataField}` : ""}
                </p>
                {event.previousValue !== null && (
                  <p className="work-item-activity__value">
                    <span>Previous:</span> {event.previousValue}
                  </p>
                )}
                {event.newValue !== null && (
                  <p className="work-item-activity__value">
                    <span>New:</span> {event.newValue}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {state.loadMoreError && (
        <p className="work-item-activity__error" role="alert">
          {state.loadMoreError}
        </p>
      )}
      {state.nextCursor && (
        <button
          className="work-items__load-more"
          disabled={state.loadingMore}
          onClick={loadMore}
          type="button"
        >
          {state.loadingMore
            ? "Loading activity…"
            : state.loadMoreError
              ? "Retry loading activity"
              : "Load more activity"}
        </button>
      )}
    </section>
  );
}

type WorkItemDetailsState =
  | { itemId: string; status: "loading" }
  | { itemId: string; status: "error"; message: string }
  | { itemId: string; status: "loaded"; item: WorkItemDetails };

function WorkItemDetailsPanel({
  itemId,
  onClose,
  onUpdated,
}: {
  itemId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { session, authenticatedRequest } = useAuth();
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<WorkItemDetailsState>({
    itemId,
    status: "loading",
  });
  const [draft, setDraft] = useState<WorkItemDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [claimError, setClaimError] = useState("");
  const [claimSuccess, setClaimSuccess] = useState("");
  const [isClaiming, setIsClaiming] = useState(false);
  const [transitionError, setTransitionError] = useState("");
  const [transitionSuccess, setTransitionSuccess] = useState("");
  const [pendingTransition, setPendingTransition] =
    useState<WorkItemStatus | null>(null);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const [hasConflict, setHasConflict] = useState(false);
  const saving = useRef(false);
  const claiming = useRef(false);
  const transitioning = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    getWorkItemDetails(authenticatedRequest, itemId, controller.signal)
      .then((item) => {
        setState({ itemId, status: "loaded", item });
        setDraft(draftFromWorkItem(item));
        setError("");
        setSuccess("");
        setHasConflict(false);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          itemId,
          status: "error",
          message:
            requestError instanceof Error
              ? requestError.message
              : "Unable to load work-item details.",
        });
        setDraft(null);
      });
    return () => controller.abort();
  }, [authenticatedRequest, itemId, reload]);

  const currentState = state.itemId === itemId ? state : null;
  const item = currentState?.status === "loaded" ? currentState.item : null;
  const role = item
    ? session?.user.memberships.find(
        ({ team }) => team.id === item.teamId,
      )?.role
    : undefined;
  const canEdit = role !== undefined && role !== "VIEWER";
  const canClaim =
    canEdit && item?.status === "OPEN" && item.assigneeId === null;
  const transitions = item
    ? availableTransitions(item.status, role)
    : [];

  function reloadDetails() {
    setState({ itemId, status: "loading" });
    setReload((value) => value + 1);
  }

  async function handleClaim() {
    if (!item || !canClaim || claiming.current) return;

    claiming.current = true;
    setIsClaiming(true);
    setClaimError("");
    setClaimSuccess("");
    try {
      await claimWorkItem(authenticatedRequest, item.id);
      setClaimSuccess("Work item claimed successfully.");
      reloadDetails();
      onUpdated();
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.code === "CLAIM_CONFLICT") {
        setClaimError(
          "This item was claimed or became ineligible before your request completed. Its latest details are being loaded.",
        );
        reloadDetails();
        onUpdated();
      } else if (requestError instanceof ApiError && requestError.code === "FORBIDDEN") {
        setClaimError("Your role in this team does not allow claiming work items.");
      } else if (requestError instanceof ApiError && requestError.code === "NOT_FOUND") {
        setClaimError("This item is no longer available to your team.");
      } else {
        setClaimError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to claim the work item. Please try again.",
        );
      }
    } finally {
      claiming.current = false;
      setIsClaiming(false);
    }
  }

  async function handleTransition(targetStatus: WorkItemStatus) {
    if (!item || !transitions.includes(targetStatus) || transitioning.current) {
      return;
    }

    transitioning.current = true;
    setPendingTransition(targetStatus);
    setTransitionError("");
    setTransitionSuccess("");
    try {
      const updated = await transitionWorkItem(
        authenticatedRequest,
        item.id,
        targetStatus,
        item.version,
      );
      setTransitionSuccess(
        `Work item moved to ${updated.status.replaceAll("_", " ")}.`,
      );
      reloadDetails();
      onUpdated();
    } catch (requestError) {
      if (
        requestError instanceof ApiError &&
        requestError.code === "VERSION_CONFLICT"
      ) {
        setTransitionError(
          "This work item changed after it was loaded. The transition was not applied; reloading the latest state.",
        );
        reloadDetails();
        onUpdated();
      } else if (
        requestError instanceof ApiError &&
        requestError.code === "INVALID_TRANSITION"
      ) {
        setTransitionError(
          "That transition is no longer allowed for the work item’s current status.",
        );
        reloadDetails();
      } else if (
        requestError instanceof ApiError &&
        requestError.code === "FORBIDDEN"
      ) {
        setTransitionError(
          "Your role in this team does not allow this workflow transition.",
        );
      } else if (
        requestError instanceof ApiError &&
        requestError.code === "VALIDATION_ERROR"
      ) {
        setTransitionError(
          `The backend rejected the transition request: ${requestError.message}`,
        );
      } else if (
        requestError instanceof ApiError &&
        requestError.code === "NOT_FOUND"
      ) {
        setTransitionError("This work item is no longer available to your team.");
      } else {
        setTransitionError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to update the work-item status. Please try again.",
        );
      }
    } finally {
      transitioning.current = false;
      setPendingTransition(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item || !draft || saving.current || hasConflict) return;

    const title = draft.title.trim();
    if (!title) {
      setError("Enter a title for the work item.");
      setSuccess("");
      return;
    }
    if (title.length > 200 || draft.description.length > 10000) {
      setError("The title must be 200 characters or fewer and description must be 10,000 characters or fewer.");
      setSuccess("");
      return;
    }
    const parsedDueDate = draft.dueDate
      ? new Date(`${draft.dueDate}T00:00:00.000Z`)
      : null;
    if (parsedDueDate && Number.isNaN(parsedDueDate.getTime())) {
      setError("Enter a valid due date.");
      setSuccess("");
      return;
    }

    const input: UpdateWorkItemInput = {
      version: item.version,
      title,
      description: draft.description,
      type: draft.type,
      priority: draft.priority,
      dueDate: parsedDueDate?.toISOString() ?? null,
    };
    saving.current = true;
    setIsSaving(true);
    setError("");
    setSuccess("");
    try {
      const updated = await updateWorkItem(
        authenticatedRequest,
        item.id,
        input,
      );
      const updatedDetails: WorkItemDetails = { ...item, ...updated };
      setState({ itemId, status: "loaded", item: updatedDetails });
      setDraft(draftFromWorkItem(updatedDetails));
      setSuccess("Work-item changes saved.");
      onUpdated();
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 409) {
        setHasConflict(true);
        setError(
          "This work item changed after you opened it. Your edits were not saved. Reload the latest version before continuing.",
        );
      } else if (requestError instanceof ApiError && requestError.status === 400) {
        setError(`Check the work-item details: ${requestError.message}`);
      } else if (requestError instanceof ApiError && requestError.status === 403) {
        setError("Your role in this team does not allow editing work items.");
      } else if (requestError instanceof ApiError && requestError.status === 404) {
        setError("This work item is no longer available to your team.");
      } else {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to save work-item changes. Please retry.",
        );
      }
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  }

  return (
    <section className="work-item-details" aria-labelledby="work-item-details-title">
      <div className="work-item-details__heading">
        <h2 id="work-item-details-title">Work-item details</h2>
        <button
          className="work-items__retry"
          onClick={onClose}
          type="button"
        >
          Back to list
        </button>
      </div>
      {currentState?.status === "loading" && (
        <p className="work-items__message" role="status">
          Loading work-item details…
        </p>
      )}
      {currentState?.status === "error" && (
        <div className="work-items__message work-items__message--error" role="alert">
          <p>{currentState.message}</p>
          <button
            className="work-items__retry"
            onClick={reloadDetails}
            type="button"
          >
            Retry
          </button>
        </div>
      )}
      {item && draft && (
        <>
          {claimError && (
            <p className="create-work-item__error" role="alert">
              {claimError}
            </p>
          )}
          {claimSuccess && (
            <p className="create-work-item__success" role="status">
              {claimSuccess}
            </p>
          )}
          {transitionError && (
            <p className="create-work-item__error" role="alert">
              {transitionError}
            </p>
          )}
          {transitionSuccess && (
            <p className="create-work-item__success" role="status">
              {transitionSuccess}
            </p>
          )}
          <dl className="work-item-details__facts">
            <div>
              <dt>Status</dt>
              <dd>{item.status.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Team</dt>
              <dd>{item.team.name}</dd>
            </div>
            <div>
              <dt>Assignee</dt>
              <dd>{item.assignee?.name ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt>Created by</dt>
              <dd>{item.createdBy.name}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{item.version}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{new Date(item.updatedAt).toLocaleString()}</dd>
            </div>
          </dl>
          {canClaim && (
            <div className="work-item-details__claim">
              <button
                className="work-items__filter-button"
                disabled={isClaiming}
                onClick={handleClaim}
                type="button"
              >
                {isClaiming ? "Claiming…" : "Claim this work item"}
              </button>
            </div>
          )}
          {transitions.length > 0 && (
            <div className="work-item-details__transitions">
              <h3>Workflow</h3>
              <div className="work-item-details__transition-actions">
                {transitions.map((targetStatus) => (
                  <button
                    className="work-items__filter-button"
                    disabled={pendingTransition !== null}
                    key={targetStatus}
                    onClick={() => handleTransition(targetStatus)}
                    type="button"
                  >
                    {pendingTransition === targetStatus
                      ? "Updating status…"
                      : `Move to ${targetStatus.replaceAll("_", " ")}`}
                  </button>
                ))}
              </div>
            </div>
          )}
          {canEdit ? (
            <form className="work-item-details__form" onSubmit={handleSubmit}>
              <label>
                <span>Title</span>
                <input
                  aria-label="Work-item title"
                  disabled={isSaving || hasConflict}
                  maxLength={200}
                  onChange={(event) =>
                    setDraft({ ...draft, title: event.target.value })
                  }
                  required
                  value={draft.title}
                />
              </label>
              <label>
                <span>Description</span>
                <textarea
                  aria-label="Work-item description"
                  disabled={isSaving || hasConflict}
                  maxLength={10000}
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                  rows={4}
                  value={draft.description}
                />
              </label>
              <div className="create-work-item__options">
                <label>
                  <span>Type</span>
                  <select
                    aria-label="Work-item type"
                    disabled={isSaving || hasConflict}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        type: event.target.value as WorkItemType,
                      })
                    }
                    value={draft.type}
                  >
                    <option value="INCIDENT">Incident</option>
                    <option value="CUSTOMER_ISSUE">Customer issue</option>
                    <option value="PAYMENT">Payment</option>
                    <option value="COMPLIANCE">Compliance</option>
                    <option value="TASK">Task</option>
                  </select>
                </label>
                <label>
                  <span>Priority</span>
                  <select
                    aria-label="Work-item priority"
                    disabled={isSaving || hasConflict}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        priority: event.target.value as WorkItemPriority,
                      })
                    }
                    value={draft.priority}
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </label>
                <label>
                  <span>Due date</span>
                  <input
                    aria-label="Work-item due date"
                    disabled={isSaving || hasConflict}
                    onChange={(event) =>
                      setDraft({ ...draft, dueDate: event.target.value })
                    }
                    type="date"
                    value={draft.dueDate}
                  />
                </label>
              </div>
              {error && (
                <p className="create-work-item__error" role="alert">
                  {error}
                </p>
              )}
              {success && (
                <p className="create-work-item__success" role="status">
                  {success}
                </p>
              )}
              {hasConflict && (
                <p className="work-item-details__conflict" role="note">
                  Reloading the latest version will replace your unsaved edits.
                </p>
              )}
              {hasConflict ? (
                <button
                  className="work-items__filter-button"
                  onClick={reloadDetails}
                  type="button"
                >
                  Reload latest version
                </button>
              ) : (
                <button
                  className="work-items__filter-button"
                  disabled={isSaving}
                  type="submit"
                >
                  {isSaving ? "Saving…" : "Save changes"}
                </button>
              )}
            </form>
          ) : (
            <p className="work-item-details__readonly" role="status">
              Your role in this team allows viewing but not editing this item.
            </p>
          )}
          <WorkItemActivityTimeline
            key={`${item.id}:${item.version}:${activityRefreshKey}`}
            itemId={item.id}
          />
          <WorkItemComments
            key={item.id}
            canComment={canEdit}
            itemId={item.id}
            onCommentAdded={() =>
              setActivityRefreshKey((value) => value + 1)
            }
          />
        </>
      )}
    </section>
  );
}

type DashboardState =
  | { requestKey: string; status: "loading" }
  | { requestKey: string; status: "error"; message: string }
  | {
      requestKey: string;
      status: "loaded";
      dashboard: WorkItemDashboard;
    };

const dashboardMetrics = [
  { key: "assignedToMe", label: "Assigned to me" },
  { key: "unassignedUrgent", label: "Unassigned urgent" },
  { key: "awaitingApproval", label: "Awaiting my approval" },
  { key: "overdue", label: "Overdue" },
] as const;

const dashboardStatuses: WorkItemStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "AWAITING_APPROVAL",
  "RESOLVED",
  "CLOSED",
];

function WorkItemDashboardPanel({
  hasTeams,
  refreshKey,
  onRefresh,
}: {
  hasTeams: boolean;
  refreshKey: number;
  onRefresh: () => void;
}) {
  const { authenticatedRequest } = useAuth();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<DashboardState>({
    requestKey: "",
    status: "loading",
  });
  const requestKey = `${refreshKey}:${retry}`;

  useEffect(() => {
    if (!hasTeams) return;
    const controller = new AbortController();
    getWorkItemDashboard(authenticatedRequest, controller.signal)
      .then((dashboard) =>
        setState({ requestKey, status: "loaded", dashboard }),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          requestKey,
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to load the dashboard. Please try again.",
        });
      });
    return () => controller.abort();
  }, [authenticatedRequest, hasTeams, requestKey]);
  const visibleState: DashboardState =
    state.requestKey === requestKey
      ? state
      : { requestKey, status: "loading" };

  return (
    <section className="dashboard" aria-labelledby="dashboard-title">
      <div className="dashboard__heading">
        <div>
          <h2 id="dashboard-title">Dashboard</h2>
          <p>Metrics across all teams you belong to.</p>
        </div>
        <a className="dashboard__link" href="#work-items-title">
          View work items
        </a>
      </div>
      {!hasTeams ? (
        <p className="work-items__message">
          Join a team to see your operational dashboard.
        </p>
      ) : visibleState.status === "loading" ? (
        <p className="work-items__message" role="status">
          Loading dashboard…
        </p>
      ) : visibleState.status === "error" ? (
        <div className="work-items__message work-items__message--error" role="alert">
          <p>{visibleState.message}</p>
          <button
            className="work-items__retry"
            onClick={() => setRetry((value) => value + 1)}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="dashboard__metrics">
            {dashboardMetrics.map(({ key, label }) => (
              <div className="dashboard__metric" key={key}>
                <span>{label}</span>
                <strong>{visibleState.dashboard[key]}</strong>
              </div>
            ))}
          </div>
          <div className="dashboard__status">
            <h3>Work items by status</h3>
            <dl>
              {dashboardStatuses.map((status) => (
                <div key={status}>
                  <dt>{status.replaceAll("_", " ")}</dt>
                  <dd>{visibleState.dashboard.itemsByStatus[status]}</dd>
                </div>
              ))}
            </dl>
          </div>
          <button
            className="work-items__retry dashboard__refresh"
            onClick={onRefresh}
            type="button"
          >
            Refresh dashboard
          </button>
        </>
      )}
    </section>
  );
}

function WorkItemList({
  teamId,
  onTeamChange,
  onDashboardRefresh,
}: {
  teamId: string;
  onTeamChange: (teamId: string) => void;
  onDashboardRefresh: () => void;
}) {
  const { session, authenticatedRequest } = useAuth();
  const teams = session?.user.memberships ?? [];
  const [status, setStatus] = useState<WorkItemStatus | "">("");
  const [priority, setPriority] = useState<WorkItemPriority | "">("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [retry, setRetry] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [listState, setListState] = useState<WorkItemListState | null>(null);
  const filterKey = JSON.stringify([teamId, status, priority, search]);

  useEffect(() => {
    if (!teamId) return;

    const controller = new AbortController();
    const isNextPage = Boolean(cursor);

    listWorkItems(
      authenticatedRequest,
      {
        teamId,
        ...(status ? { status } : {}),
        ...(priority ? { priority } : {}),
        ...(search ? { search } : {}),
        ...(cursor ? { cursor } : {}),
      },
      controller.signal,
    )
      .then((page) => {
        setListState((current) => {
          const sameFilter = current?.teamId === teamId && current.filtersKey === filterKey;
          return {
            teamId,
            filtersKey: filterKey,
            items: [
              ...(isNextPage && sameFilter ? current.items : []),
              ...page.data,
            ],
            nextCursor: page.meta.nextCursor,
            loading: false,
            loadingMore: false,
            error: null,
          };
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setListState((current) => {
          const sameFilter = current?.teamId === teamId && current.filtersKey === filterKey;
          return {
            teamId,
            filtersKey: filterKey,
            items: isNextPage && sameFilter ? current.items : [],
            nextCursor: isNextPage && sameFilter ? current.nextCursor : null,
            loading: false,
            loadingMore: false,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load work items. Please try again.",
          };
        });
      });

    return () => controller.abort();
  }, [
    authenticatedRequest,
    cursor,
    filterKey,
    priority,
    retry,
    search,
    status,
    teamId,
  ]);

  const visibleState =
    listState?.teamId === teamId && listState.filtersKey === filterKey
      ? listState
      : null;

  function updateTeam(value: string) {
    onTeamChange(value);
    setCursor(undefined);
    setSelectedItemId(null);
  }

  function updateStatus(value: WorkItemStatus | "") {
    setStatus(value);
    setCursor(undefined);
  }

  function updatePriority(value: WorkItemPriority | "") {
    setPriority(value);
    setCursor(undefined);
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCursor(undefined);
    setSearch(searchInput.trim());
  }

  function retryRequest() {
    setListState((current) =>
      current?.teamId === teamId && current.filtersKey === filterKey
        ? {
            ...current,
            loading: current.items.length === 0,
            loadingMore: current.items.length > 0,
            error: null,
          }
        : current,
    );
    setRetry((current) => current + 1);
  }

  function loadNextPage() {
    if (!visibleState?.nextCursor || visibleState.loadingMore) return;
    setListState({ ...visibleState, loadingMore: true, error: null });
    setCursor(visibleState.nextCursor);
  }

  function handleCreated() {
    setStatus("");
    setPriority("");
    setSearchInput("");
    setSearch("");
    setCursor(undefined);
    setRetry((current) => current + 1);
    onDashboardRefresh();
  }

  function handleItemUpdated() {
    retryRequest();
    onDashboardRefresh();
  }

  if (teams.length === 0) {
    return (
      <section className="work-items" aria-labelledby="work-items-title">
        <h2 id="work-items-title">Work items</h2>
        <p>You do not have access to any team work items.</p>
      </section>
    );
  }

  return (
    <section className="work-items" aria-labelledby="work-items-title">
      <div className="work-items__heading">
        <div>
          <h2 id="work-items-title">Work items</h2>
          <p>Items are limited to teams you belong to.</p>
        </div>
        <label className="work-items__team">
          <span>Team</span>
          <select
            aria-label="Team"
            disabled={isCreating}
            onChange={(event) => updateTeam(event.target.value)}
            value={teamId}
          >
            {teams.map(({ team, role }) => (
              <option key={team.id} value={team.id}>
                {team.name} · {role}
              </option>
            ))}
          </select>
        </label>
      </div>

      <CreateWorkItemForm
        teamId={teamId}
        role={teams.find(({ team }) => team.id === teamId)?.role}
        onCreated={handleCreated}
        onSubmittingChange={setIsCreating}
      />

      <form className="work-item-filters" onSubmit={applyFilters}>
        <label>
          <span>Search</span>
          <input
            aria-label="Search work items"
            maxLength={200}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search titles and descriptions"
            type="search"
            value={searchInput}
          />
        </label>
        <label>
          <span>Status</span>
          <select
            aria-label="Filter by status"
            onChange={(event) => updateStatus(event.target.value as WorkItemStatus | "")}
            value={status}
          >
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="AWAITING_APPROVAL">Awaiting approval</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        <label>
          <span>Priority</span>
          <select
            aria-label="Filter by priority"
            onChange={(event) => updatePriority(event.target.value as WorkItemPriority | "")}
            value={priority}
          >
            <option value="">All priorities</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </label>
        <button className="work-items__filter-button" type="submit">
          Apply filters
        </button>
      </form>

      {visibleState?.loading || !visibleState ? (
        <p className="work-items__message" role="status">
          Loading work items…
        </p>
      ) : visibleState.error ? (
        <div className="work-items__message work-items__message--error" role="alert">
          <p>{visibleState.error}</p>
          <button
            className="work-items__retry"
            onClick={retryRequest}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : visibleState.items.length === 0 ? (
        <p className="work-items__message">No work items match these filters.</p>
      ) : (
        <>
          <ul className="work-item-list">
            {visibleState.items.map((item) => (
              <li className="work-item" key={item.id}>
                <div className="work-item__main">
                  <h3>
                    <button
                      className="work-item__open"
                      onClick={() => setSelectedItemId(item.id)}
                      type="button"
                    >
                      {item.title}
                    </button>
                  </h3>
                  <p>{item.type.replaceAll("_", " ")}</p>
                </div>
                <span className={`work-item__status work-item__status--${item.status.toLowerCase()}`}>
                  {item.status.replaceAll("_", " ")}
                </span>
                <span className={`work-item__priority work-item__priority--${item.priority.toLowerCase()}`}>
                  {item.priority}
                </span>
                <span className="work-item__assignee">
                  {item.assignee?.name ?? "Unassigned"}
                </span>
                <time className="work-item__due-date" dateTime={item.dueDate ?? undefined}>
                  {item.dueDate
                    ? new Date(item.dueDate).toLocaleDateString()
                    : "No due date"}
                </time>
              </li>
            ))}
          </ul>
          {visibleState.nextCursor && (
            <button
              className="work-items__load-more"
              disabled={visibleState.loadingMore}
              onClick={loadNextPage}
              type="button"
            >
              {visibleState.loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
      {selectedItemId && (
        <WorkItemDetailsPanel
          key={selectedItemId}
          itemId={selectedItemId}
          onClose={() => setSelectedItemId(null)}
          onUpdated={handleItemUpdated}
        />
      )}
    </section>
  );
}

function AuthenticatedPanel() {
  const { session, logout } = useAuth();
  const [selectedTeamId, setSelectedTeamId] = useState(
    session?.user.memberships[0]?.team.id ?? "",
  );
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  if (!session) return null;

  return (
    <section className="workspace-card" aria-labelledby="signed-in-title">
      <div className="workspace-card__header">
        <div>
          <div className="auth-card__eyebrow">AUTHENTICATED</div>
          <h1 id="signed-in-title">You’re signed in</h1>
          <p className="authenticated-user__name">{session.user.name}</p>
          <p className="authenticated-user__email">{session.user.email}</p>
        </div>
        <button
          className="workspace-card__sign-out"
          onClick={logout}
          type="button"
        >
          Sign out
        </button>
      </div>
      <WorkItemDashboardPanel
        hasTeams={session.user.memberships.length > 0}
        onRefresh={() => setDashboardRefreshKey((value) => value + 1)}
        refreshKey={dashboardRefreshKey}
      />
      <WorkItemList
        teamId={selectedTeamId}
        onTeamChange={setSelectedTeamId}
        onDashboardRefresh={() =>
          setDashboardRefreshKey((value) => value + 1)
        }
      />
    </section>
  );
}

function AuthenticationScreen() {
  const { session } = useAuth();

  return (
    <main className="auth-page">
      <header className="auth-page__header">
        <a className="brand" href="/" aria-label="Newtonite home">
          <span className="brand__mark" aria-hidden="true">
            N
          </span>
          <span>Newtonite</span>
        </a>
        <BackendStatus />
      </header>

      <div className="auth-page__content">
        {session ? <AuthenticatedPanel /> : <LoginForm />}
      </div>
      <footer className="auth-page__footer">
        Internal operations workspace
      </footer>
    </main>
  );
}

function App() {
  return (
    <AuthProvider>
      <AuthenticationScreen />
    </AuthProvider>
  );
}

export default App;
