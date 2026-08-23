# @opencrane/backend/server/infra/workflows/oauth-refresh — saved OAuth connection checks

> [infra](../../README.md) › [workflows](../README.md) › oauth-refresh

## What it owns

This package defines a workflow that rechecks one OAuth connection. OAuth is a way for a person to
allow an external service to act without giving OpenCrane their password. A workflow is saved work
that can run later or continue after the server restarts.

The product decides that a connection needs checking, then saves the product change and the task in
the same database transaction. When a worker runs the task, this package calls the connection owner.
That owner refreshes the external connection and stores any credential outside OpenCrane's database.

```text
 product change
     │  save change + task in the same database transaction
     ▼
 ┌───────────────────────────────────┐
 │ oauth-refresh  ◄── HERE            │  silo + subject + connection identifiers
 └────────────────┬──────────────────┘
                  │  replay-safe refresh check
                  ▼
 connection owner ──► external OAuth service
                  │  refreshed · reconnect needed · removed
                  ▼
             product connection state
```

**In this flow:** the [workflow contract](../contract/README.md) saves and runs the task; the product
connection owner keeps OAuth credentials out of task input and out of this package.

There is at most one saved task for a silo, subject, connection, and refresh time. Repeating the same
request returns that task; a later refresh time creates the next task for the same connection. The
task key and diagnostic fields use a hash, so they do not contain the subject or connection identifier.
The saved input carries identifiers and the refresh time only; it never carries an access token,
refresh token, or password.

## Public surface

- `__CreateOAuthRefreshWorkflow` — registers the task and returns the admission API.
- `__OAuthRefreshTaskKey` — derives the stable, identifier-hiding task key.
- `OAuthRefreshConnectionPort` — the product-owned connection refresh operation.
- `OAuthRefreshTaskInput` and `OAuthRefreshResult` — the credential-free task request and outcome.

## Boundary

Application composition supplies an approved workflow engine and the connection port. This package
does not store OAuth credentials, open an OAuth browser flow, choose a worker queue, or own product
connection records.

## Dependency direction

This is an infrastructure library with `scope:workflows`. It imports only the workflow contract and
must never import an application or product domain.

## See also

- Parent: [workflows](../README.md)
- Shared workflow rules: [contract](../contract/README.md)
