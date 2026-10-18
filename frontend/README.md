# Newtonite frontend

React 19, TypeScript, and Vite frontend for the Newtonite work management API.

## Install

From `frontend/`:

```sh
npm install
```

The development API defaults to `http://localhost:5001/api`. Set `VITE_API_URL` if your local backend uses a different URL.

## Run locally

Start PostgreSQL and the backend first. From the repository root:

```sh
docker compose up -d postgres
cd backend
npm run dev
```

In a second terminal, from `frontend/`:

```sh
npm run dev
```

The Vite development server is available at `http://localhost:5173`.

## Test and validate

Run from `frontend/`:

```sh
npm test
npm run lint
npm run build
```

Tests use Vitest and React Testing Library with a jsdom environment. API responses are mocked at the `fetch` boundary using the backend's response envelopes; these tests do not replace live API or real-browser verification.
