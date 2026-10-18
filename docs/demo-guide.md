# Newtonite — Demo Guide

## 1. Preparation

- Start PostgreSQL using Docker Compose.
- Start the backend API.
- Start the React frontend.
- Verify that the application is healthy.
- Log in using a seeded development account.

## 2. Application Walkthrough

### Authentication
Demonstrate login and explain how JWT authentication protects API routes.

### Dashboard
Show the dashboard metrics and explain how the backend provides the data.

### Work Items
Demonstrate searching, filtering, pagination, and viewing item details.

### Create and Edit
Create a work item and update its fields.

### Claiming and Workflow
Claim an eligible item and perform a permitted status transition.

### Concurrency
Explain how atomic claiming and optimistic locking prevent conflicting updates.

### Comments and Activity
Add a comment and show the activity timeline.

### Authorization
Explain how the backend checks team memberships and permissions.

### Transactional Outbox
Explain how the backend records outbox jobs transactionally and how the
background worker processes jobs with retries.

## 3. Engineering Decisions

Be prepared to explain:

- Team-based authorization
- Atomic claims
- Optimistic concurrency
- Idempotent requests
- Transactional activity history
- Outbox processing and retry behavior

## 4. Known Limitations

- External notifications are not implemented.
- The outbox worker runs within the backend process.
- Login rate limiting uses process-local memory.
- Frontend automated tests use mocked API responses.

Verify all features against the running application before demonstrating them.