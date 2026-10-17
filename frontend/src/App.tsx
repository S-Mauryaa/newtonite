import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthProvider } from "./auth/AuthProvider";
import { useAuth } from "./auth/useAuth";
import {
  ApiError,
  getBackendHealth,
  listWorkItems,
  type WorkItem,
  type WorkItemPriority,
  type WorkItemStatus,
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

function WorkItemList() {
  const { session, authenticatedRequest } = useAuth();
  const teams = session?.user.memberships ?? [];
  const [teamId, setTeamId] = useState(teams[0]?.team.id ?? "");
  const [status, setStatus] = useState<WorkItemStatus | "">("");
  const [priority, setPriority] = useState<WorkItemPriority | "">("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [retry, setRetry] = useState(0);
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
  }, [authenticatedRequest, cursor, filterKey, priority, retry, search, status, teamId]);

  const visibleState =
    listState?.teamId === teamId && listState.filtersKey === filterKey
      ? listState
      : null;

  function updateTeam(value: string) {
    setTeamId(value);
    setCursor(undefined);
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
                  <h3>{item.title}</h3>
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
    </section>
  );
}

function AuthenticatedPanel() {
  const { session, logout } = useAuth();
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
      <WorkItemList />
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
