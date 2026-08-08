# Identity and onboarding user stories

## Feature intent

Bring a person from an anonymous browser to a truthful, authority-bound starting point. Identity,
organisation, and role come from the server session; the browser never chooses its own silo.

Current status: `API partial`, `UI early`, `Design ready` for sign-in and owner admission, and
`API blocked` for workspace provisioning.

## IDO-01 — Sign in through the configured identity provider

**As an** invited or eligible user, **I want** to sign in through my organisation's identity
provider **so that** OpenCrane can use my verified identity and current authority.

Acceptance criteria:

- An anonymous visitor can start sign-in and return to a sanitized in-product destination.
- Loading, identity-provider unavailable, access denied, expired state, and callback failure are
  distinct states.
- Errors such as no access / user unknown / ... are clearly displayed when login fails
- The browser never displays or stores OIDC client secrets, session secrets, PKCE verifiers, or
  raw tokens.
- A failed configured allowlist or first-owner admission does not leave a misleading signed-in UI.

API: `GET /api/v1/auth/me`, `GET /api/v1/auth/login`, `GET /api/v1/auth/callback`.

## IDO-02 — Understand my active identity and authority

**As a** signed-in user, **I want** to see which identity, organisation, and role are active **so
that** I understand what I can access and administer.

Acceptance criteria:

- The UI uses the server-projected name, email, picture, ClusterTenant, groups, owned organisations,
  `isOrgAdmin`, and `isPlatformOperator` values.
- Missing role configuration resolves to ordinary-user capability, not optimistic admin access.
- Host/silo mismatch or lost membership produces a bounded no-access state without leaking another
  silo's existence.

Design states: loading, signed out, signed in, no active organisation, ordinary member, organisation
admin, platform operator, and session error.

API: `GET /api/v1/auth/me`.

## IDO-03 — Claim the first standalone Owner slot

**As the** configured bootstrap owner, **I want** my first verified login to claim the standalone
Owner membership **so that** a clean silo has one accountable administrator.

Acceptance criteria:

- Admission requires the configured host tenant, issuer, stable subject, and verified bootstrap
  email.
- The UI handles `admitted`, `already_owner`, `not_eligible`, and `already_claimed` without implying
  that email itself is the durable identity.
- Membership creation and its audit record appear as one completed outcome.
- Non-eligible and already-claimed outcomes direct the user to an explicit recovery path.

API: part of the OIDC callback handshake; no browser-supplied owner-claim payload.

## IDO-04 — Sign out safely

**As a** signed-in user, **I want** to sign out locally and, when supported, at the identity provider
**so that** another person cannot continue my session.

Acceptance criteria:

- Local session state is cleared before the browser presents a signed-out state.
- The UI follows the returned identity-provider end-session URL only when supplied.
- Sign-out failure does not preserve a visually authenticated shell.

API: `POST /api/v1/auth/logout`.

## IDO-05 — Continue onboarding from the real next requirement

**As a** newly admitted Owner, **I want** onboarding to inspect server-side readiness **so that** I
continue with persona, workspace, or recovery instead of repeating decorative welcome steps.

Acceptance criteria:

- Completion is not defined by local or session storage.
- The journey derives its next step from session authority, persona status, personal-agent
  availability, and workspace/thread readiness.
- Refreshing or changing device resumes the same server-known position.
- The current `Welcome → Workspace → Personalize → Tour → Finish` local-only loop is not retained as
  product authority.

Status: `API blocked`. Persona status exists, but personal workspace/AgentService provisioning and a
complete onboarding-status projection do not.

## IDO-06 — Start registration intentionally

**As a** new eligible user, **I want** a registration action that the identity provider understands
**so that** “Create account” is not merely another sign-in button.

Acceptance criteria:

- The backend explicitly accepts, validates, and forwards the intended registration prompt, or the
  UI removes the separate registration claim.
- Unsupported provider registration is explained before redirect.

Status: `API partial`. The frontend currently sends `prompt=create`, but the backend ignores it.
