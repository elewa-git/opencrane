import { URL } from "node:url";

import type { Request, RequestHandler } from "express";
import session from "express-session";
import * as client from "openid-client";
import type { Logger } from "pino";

import { ___LoadOidcAuthConfig } from "./oidc-config";
import type { OidcAuthConfig } from "./oidc-config.types";
import { _ResolveIdentityClaims } from "./identity-claims";
import { _ResolveOrgMembershipFacts } from "./org-membership";
import type { OrgMembershipRepository } from "./org-membership.types";
import type { AuthStatus, LoginClient } from "./oidc-service.types";
import { _buildCurrentUrl, _buildPostLogoutRedirectUri, _buildRedirectUri, _destroySession, _regenerateSession, _sanitizeReturnTo, _saveSession } from "./session";
import type { AuthUser } from "./session.types";

export type { AuthStatus, AuthStatusUser, LoginClient, ManagerAuthMode } from "./oidc-service.types";

/**
 * Base class for the OpenCrane server's browser login. One instance per server process
 * owns the whole human login story: discovering the identity provider, sending the
 * browser there with PKCE, exchanging the returned code for tokens, checking the claims
 * against the configured email allowlists, storing the user in an `express-session`
 * cookie session, and answering `/auth/me`.
 *
 * The order is fixed and a subclass cannot change it:
 *   1. {@link buildLoginUrl} — pick the OIDC client through {@link resolveLoginClient},
 *      generate the PKCE verifier plus `state` and `nonce`, save them in the session,
 *      and return the provider URL to redirect to.
 *   2. The browser returns to the callback route, which calls {@link completeLogin} —
 *      exchange the code against the SAME client_id the session recorded, merge ID-token
 *      and UserInfo claims, apply the allowlists, give the session a new id, then store
 *      `authUser`.
 *   3. {@link onLoginEstablished} runs last, once per login, with the session already
 *      saved.
 *
 * Only two methods exist to be overridden:
 *   - {@link resolveLoginClient} — which OIDC client and scope a login uses. The base
 *     uses the single "masters" client from configuration; the identity domain overrides
 *     it to look up a per-organisation client from the request host.
 *   - {@link enrichStatusUser} — extra fields on `/auth/me`. The base adds none; the
 *     identity domain adds the caller's resolved `clusterTenant`.
 * {@link onLoginEstablished} and {@link isPostLoginFailureFatal} are hooks for side
 * effects, not for changing the flow above.
 *
 * `/auth/me` does not just echo the cookie: {@link getStatus} re-reads `OrgMembership`
 * on every call, so a user who has just created an organisation counts as an org admin
 * without logging in again.
 *
 * Called by: `OidcAuthService` in libs/backend/server/iam/identity/main/src/oidc.service.ts
 * extends it; apps/opencrane/src/app/public-app.ts constructs it and mounts
 * {@link createSessionMiddleware}; libs/backend/server/iam/identity/main/src/auth.router.ts
 * calls {@link getStatus}, {@link isEnabled}, {@link buildLoginUrl}, and
 * {@link completeLogin}.
 *
 * @see https://openid.net/specs/openid-connect-core-1_0.html — the Authorization Code
 *      flow, the `state`/`nonce` replay checks, and the ID-token claims used here.
 * @see https://www.rfc-editor.org/rfc/rfc7636 — PKCE (`code_challenge_method=S256`),
 *      required because per-organisation clients are public clients with no secret.
 * @see https://github.com/panva/node-openid-client — `openid-client` (^6.8.4), which
 *      performs discovery, builds the redirect, and runs the code exchange.
 */
export abstract class OidcAuthServiceBase
{
  /** Runtime OIDC configuration loaded from environment variables. */
  protected config: OidcAuthConfig = ___LoadOidcAuthConfig();

  /** Logger used for auth lifecycle diagnostics. */
  protected log: Logger;

  /** Lazily initialized OIDC client configuration discovered from the issuer (masters client). */
  private discoveredConfig: Promise<client.Configuration> | null = null;

  /** Discovered configs keyed by a specific client_id (per-org clients at the same issuer). */
  private clientDiscovered = new Map<string, Promise<client.Configuration>>();

  /** Repository for resolving the caller's membership-derived org-admin facts. */
  protected membershipRepository: OrgMembershipRepository;

  /**
   * @param log              - Parent logger; a child scoped to `oidc-auth` is derived.
   * @param membershipRepository - Repository providing membership facts.
   */
  constructor(log: Logger, membershipRepository: OrgMembershipRepository)
  {
    this.log = log.child({ component: "oidc-auth" });
    this.membershipRepository = membershipRepository;
  }

  /**
   * Whether this process has usable OIDC configuration — that is, whether browser login
   * is possible at all. False when no OIDC environment variables are set (development
   * mode). A PARTIAL configuration never reaches here: {@link ___LoadOidcAuthConfig}
   * throws at startup instead.
   *
   * Called by: libs/backend/server/iam/identity/main/src/auth.router.ts lines 46 and 71,
   * which refuse `/auth/login` and `/auth/callback` when this is false.
   *
   * @returns True when a login redirect can be issued; false when this deployment can
   *          never establish a session.
   */
  isEnabled(): boolean
  {
    return this.config.enabled;
  }

  /**
   * Build the two Express handlers the login flow needs: the session itself and a CSRF
   * check over it.
   *
   * Mount them together, in this order, by spreading the array into `app.use`:
   *   1. `express-session` — creates the cookie-backed session.
   *   2. CSRF origin check — for a request that changes state AND comes from a caller with
   *      a session, compare the `Origin` header (or `Referer` when `Origin` is missing)
   *      against the host the request arrived on, and reject with 403 when they differ.
   *      Skipped for GET/HEAD/OPTIONS and for callers with no `authUser`, because a
   *      request that carries no session cookie cannot be a cross-site request that
   *      abuses one.
   *
   * When OIDC is disabled the array holds a single pass-through handler, so an app can
   * mount this unconditionally.
   *
   * Called by: apps/opencrane/src/app/public-app.ts.
   *
   * @returns Two handlers, in mount order; never empty.
   * @see https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
   *      — the Origin/Referer check this implements, and why it is paired with a
   *      SameSite cookie rather than relied on alone.
   * @see https://www.rfc-editor.org/rfc/rfc6265 — the cookie attributes set below
   *      (`HttpOnly`, `Secure`, `Max-Age`).
   */
  createSessionMiddleware(): RequestHandler[]
  {
    if (!this.config.enabled)
    {
      return [function _skipSession(req, res, next) { next(); }];
    }

    return [
      session({
        name: this.config.cookieName,
        secret: this.config.sessionSecret,
        resave: false,
        saveUninitialized: false,
        proxy: true,
        unset: "destroy",
        cookie: {
          httpOnly: true,
          sameSite: "lax",
          secure: this.config.cookieSecure,
          maxAge: this.config.sessionMaxAgeMs,
        },
      }),
      this._csrfOriginCheck(),
    ];
  }

  /** Reject a state-changing request from a session caller whose Origin (or Referer) is not this host. */
  private _csrfOriginCheck(): RequestHandler
  {
    const _SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
    return function _csrfCheck(req, res, next)
    {
      if (_SAFE.has(req.method) || !req.session?.authUser)
      {
        return void next();
      }

      const expected = `${req.protocol}://${req.hostname}`;
      const origin = req.headers.origin;
      const referer = req.headers.referer;

      if (origin !== undefined)
      {
        if (origin !== expected)
        {
          res.status(403).json({ error: "CSRF check failed.", code: "CSRF_ORIGIN_MISMATCH" });
          return;
        }
        return void next();
      }

      if (referer !== undefined)
      {
        let refOrigin: string;
        try { refOrigin = new URL(referer).origin; }
        catch
        {
          res.status(403).json({ error: "CSRF check failed.", code: "CSRF_INVALID_REFERER" });
          return;
        }
        if (refOrigin !== expected)
        {
          res.status(403).json({ error: "CSRF check failed.", code: "CSRF_REFERER_MISMATCH" });
          return;
        }
      }
      // Neither Origin nor Referer: non-browser API client or strict same-origin fetch.
      // SameSite=lax already blocks cross-site cookie delivery for these requests.
      next();
    };
  }

  /**
   * Answer `/auth/me`: which auth mode this server runs in, and who the caller is.
   *
   * Three outcomes:
   *   - OIDC enabled and a session exists — `authenticated: true` plus the stored
   *     `authUser`, with `isOrgAdmin` recomputed as "the value stored at login OR owns
   *     or administers at least one organisation now", `ownedOrgs` read fresh from
   *     `OrgMembership`, and whatever {@link enrichStatusUser} adds.
   *   - OIDC enabled and no session — `authenticated: false`, `user: null`.
   *   - OIDC disabled — `mode: "development"`, so the SPA knows not to offer login.
   *
   * `isOrgAdmin` is recomputed here rather than trusted from the cookie so that a user
   * who created an organisation after logging in gets admin rights without logging in
   * again. Nothing else on the user is recomputed.
   *
   * Called by: libs/backend/server/iam/identity/main/src/auth.router.ts.
   *
   * @param req - The `/auth/me` request; only its session and host are read.
   * @returns The auth mode plus the caller, or a null user when nobody is logged in.
   * @throws Whatever the membership repository throws when the database is unreachable —
   *         a failed lookup must not be reported as "administers no organisation".
   */
  async getStatus(req: Request): Promise<AuthStatus>
  {
    if (this.config.enabled)
    {
      const authUser = req.session.authUser;
      if (!authUser)
      {
        return { mode: "oidc", authenticated: false, user: null };
      }

      const [membership, extra] = await Promise.all([
        _ResolveOrgMembershipFacts(this.membershipRepository, authUser.sub),
        this.enrichStatusUser(req, authUser),
      ]);

      return {
        mode: "oidc",
        authenticated: true,
        user: {
          ...authUser,
          isOrgAdmin: authUser.isOrgAdmin || membership.isOrgAdmin,
          ownedOrgs: membership.ownedOrgs,
          ...extra,
        },
      };
    }

    return { mode: "development", authenticated: false, user: null };
  }

  /**
   * Start a login: produce the URL to redirect the browser to, and remember in the
   * session everything {@link completeLogin} will need to finish.
   *
   * Stored in `req.session.oidcFlow`: the PKCE code verifier, the `state` and `nonce`
   * values used to detect a replayed or injected callback, the sanitised page to return
   * to, and — when {@link resolveLoginClient} chose a per-organisation client — that
   * client_id, so the code is later exchanged against the SAME client. The session is
   * saved before the URL is returned, because a redirect that outran the session write
   * would come back to a callback with no flow to match.
   *
   * Called by: libs/backend/server/iam/identity/main/src/auth.router.ts.
   *
   * @param req      - The `/auth/login` request; supplies the session and the host the
   *                   redirect_uri is built from.
   * @param returnTo - Where to send the browser after login. Anything that is not a
   *                   local path is replaced with `/` to prevent an open redirect.
   * @param options  - `prompt` is passed straight through to the provider (for example
   *                   to force a re-authentication prompt).
   * @returns The absolute provider URL to redirect to.
   * @throws When the session cannot be saved, or when provider discovery fails — the
   *         caller should surface a login error rather than redirect.
   * @see https://www.rfc-editor.org/rfc/rfc7636 — the PKCE verifier/challenge pair
   *       generated here.
   */
  async buildLoginUrl(req: Request, returnTo: string, options?: { prompt?: string }): Promise<string>
  {
    // 1. Resolve which OIDC client + scope to authorize against (base = masters client).
    const login = await this.resolveLoginClient(req);

    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();
    const sanitizedReturnTo = _sanitizeReturnTo(returnTo);

    // 2. Persist the PKCE and replay-protection values, recording the resolved client_id so
    //    completeLogin exchanges the code against the SAME client (absent ⇒ masters client).
    req.session.oidcFlow = {
      codeVerifier,
      state,
      nonce,
      returnTo: sanitizedReturnTo,
      ...(login.clientId ? { clientId: login.clientId } : {}),
    };
    await _saveSession(req);

    // 3. Build a standards-only OIDC authorization redirect.
    const loginUrl = client.buildAuthorizationUrl(login.config, {
      redirect_uri: _buildRedirectUri(req, this.config.redirectUri),
      scope: login.scope,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
      ...(options?.prompt ? { prompt: options.prompt } : {}),
    });

    return loginUrl.href;
  }

  /**
   * Finish a login that {@link buildLoginUrl} started, and return the page to redirect to.
   *
   * Steps, in order: read `oidcFlow` from the session; exchange the authorization code
   * against the client_id the flow recorded (or the masters client when it recorded
   * none), checking the stored `state` and `nonce`; merge ID-token claims with UserInfo
   * claims; apply the email allowlists; give the session a new id so a session id fixed
   * by an attacker before login is discarded; store `authUser` and the id_token; then run
   * {@link onLoginEstablished}.
   *
   * A failure inside {@link onLoginEstablished} is either logged and ignored or destroys
   * the session and reaches the browser, depending on
   * {@link isPostLoginFailureFatal}. Everything before it always reaches the browser.
   *
   * Called by: libs/backend/server/iam/identity/main/src/auth.router.ts.
   *
   * @param req - The callback request; the full callback URL and the session are read.
   * @returns The local path to redirect the browser to; `/` when the original return
   *          target was missing or not a local path.
   * @throws When no login is in flight for this session (a callback that was replayed or
   *         forged), when the code exchange or the `state`/`nonce` check fails, when the
   *         claims carry no subject, when the email is unverified or outside the
   *         allowlists, or when a fatal post-login hook rejects.
   * @see https://openid.net/specs/openid-connect-core-1_0.html — the token-exchange and
   *      ID-token validation rules `openid-client` applies here.
   */
  async completeLogin(req: Request): Promise<string>
  {
    const flow = req.session.oidcFlow;
    if (!flow)
    {
      throw new Error("OIDC callback arrived without an in-flight login session");
    }

    // 1. Exchange the authorization code against the SAME client the authorization request
    //    used: the client_id recorded in the flow (per-org), else the masters client.
    const discoveredConfig = flow.clientId ? await this.discoverForClient(flow.clientId) : await this.getDiscoveredConfig();
    const tokens = await client.authorizationCodeGrant(discoveredConfig, _buildCurrentUrl(req), {
      pkceCodeVerifier: flow.codeVerifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    });

    // 2. Resolve the final set of identity claims and validate them against local allowlists.
    const claims = tokens.claims() as Record<string, unknown>;
    const mergedClaims = await this._resolveClaims(discoveredConfig, tokens.access_token, claims);
    const authUser = this._buildAuthUser(mergedClaims);
    const returnTo = _sanitizeReturnTo(flow.returnTo);

    // 3. Regenerate the session to prevent fixation, then persist the authenticated user.
    await _regenerateSession(req);
    req.session.authUser = authUser;
    if (typeof tokens.id_token === "string" && tokens.id_token !== "")
    {
      req.session.idToken = tokens.id_token;
    }
    await _saveSession(req);

    // 4. Run the deployment-selected post-login admission seam. Optional projection work remains
    //    best-effort, while an identity domain can make a one-time durable admission visible.
    try
    {
      await this.onLoginEstablished(req, authUser);
    }
    catch (err)
    {
      if (this.isPostLoginFailureFatal())
      {
        await _destroySession(req);
        throw err;
      }
      this.log.warn({ err }, "post-login hook failed (non-fatal)");
    }

    return returnTo;
  }

  /**
   * Log the user out of THIS server, and say whether the browser should also be sent to
   * the identity provider to end the session there.
   *
   * The local session is always destroyed, even when the provider URL cannot be built —
   * a provider problem must never leave the user logged in here.
   *
   * Called by: libs/backend/server/iam/identity/main/src/auth.router.ts.
   *
   * @param req - The logout request; its session and host are read.
   * @returns The provider's end-session URL to redirect to, or null when there is nothing
   *          to redirect to: OIDC is disabled, the session captured no id_token, the
   *          provider advertises no `end_session_endpoint`, or building the URL failed.
   *          A null result means "logged out locally, stay on this page".
   * @see https://openid.net/specs/openid-connect-rpinitiated-1_0.html — RP-Initiated
   *      Logout, including the `id_token_hint` and `post_logout_redirect_uri` parameters.
   */
  async logout(req: Request): Promise<string | null>
  {
    const endSessionUrl = await this._buildEndSessionUrl(req);
    await _destroySession(req);
    return endSessionUrl;
  }

  /**
   * Override point 1 of 2: choose which OIDC client and which scope string this login
   * uses. Called once, at the start of {@link buildLoginUrl}.
   *
   * The base returns the single masters client and the configured scopes. An override may
   * return a different client, and should also return its `clientId` so
   * {@link completeLogin} exchanges the code against the same client; it must NOT change
   * anything else about the flow. Use {@link discoverForClient} to get a configuration
   * for another client_id at the same issuer.
   *
   * Overridden by: `OidcAuthService.resolveLoginClient` in
   * libs/backend/server/iam/identity/main/src/oidc.service.ts, which resolves a
   * per-organisation client from the request host and falls back to `super` when the host
   * maps to no fully provisioned organisation.
   *
   * @param _req - The incoming login request (unused by the base).
   * @returns The client configuration, the scope string, and optionally the client_id to
   *          record in the session. Omitting `clientId` means "the masters client".
   * @throws Anything discovery throws; a login cannot proceed without a client.
   */
  protected async resolveLoginClient(_req: Request): Promise<LoginClient>
  {
    return { config: await this.getDiscoveredConfig(), scope: this.config.scopes };
  }

  /**
   * Override point 2 of 2: extra fields to add to the `/auth/me` user object. Called on
   * every `/auth/me`, in parallel with the membership lookup, so keep it cheap.
   *
   * The base adds nothing. Returned keys are spread over the user object LAST, so an
   * override can overwrite a base field — avoid reusing base field names unless that is
   * the intent.
   *
   * Overridden by: `OidcAuthService.enrichStatusUser` in
   * libs/backend/server/iam/identity/main/src/oidc.service.ts, which adds the caller's
   * `clusterTenant` resolved server-side from their verified subject.
   *
   * @param _req      - The status request (unused by the base).
   * @param _authUser - The identity stored in the session (unused by the base).
   * @returns Extra fields for the `/auth/me` user; an empty object adds nothing.
   * @throws A rejection fails the whole `/auth/me` call, so an override that talks to a
   *         database should decide deliberately whether to swallow its own errors.
   */
  protected async enrichStatusUser(_req: Request, _authUser: AuthUser): Promise<Record<string, unknown>>
  {
    return {};
  }

  /**
   * Side-effect hook, run once per login, after the session has already been saved with
   * the new user in it.
   *
   * A subclass MAY: write rows derived from the verified login (mirror group names, claim
   * a one-time owner record), and update `req.session.authUser` and save the session
   * again if it changed a stored flag.
   * A subclass MUST NOT: treat this as an authorization check for the login itself —
   * the user is already logged in by the time it runs — and must not assume it runs
   * before the browser is redirected on to `returnTo`.
   *
   * What a failure here does depends on {@link isPostLoginFailureFatal}: false (the base)
   * logs a warning and the login still succeeds; true destroys the session and rethrows,
   * so the browser sees the login fail. Nothing else in this class inspects the outcome.
   *
   * Overridden by: `OidcAuthService.onLoginEstablished` in
   * libs/backend/server/iam/identity/main/src/oidc.service.ts, which mirrors group names
   * (best effort), then evaluates first-owner admission; an `AlreadyClaimed` result returns normally so an authenticated invitee can reach guarded invitation acceptance.
   *
   * @param _req      - The completed callback request (unused by the base).
   * @param _authUser - The identity just stored in the session (unused by the base).
   * @throws Whatever the override throws; see above for what happens to it.
   */
  protected async onLoginEstablished(_req: Request, _authUser: AuthUser): Promise<void>
  {
  }

  /**
   * Whether a failure inside {@link onLoginEstablished} must fail the login.
   *
   * False (the base) — log a warning, keep the session, redirect the user on. Choose this
   * when the hook only does optional work.
   * True — destroy the session and rethrow, so the user sees a failed login. Choose this
   * when the hook establishes something the user cannot function without; letting them in
   * would strand them in a half-set-up state.
   *
   * Overridden by: `OidcAuthService.isPostLoginFailureFatal` in
   * libs/backend/server/iam/identity/main/src/oidc.service.ts, which returns true only
   * when standalone first-owner admission is configured.
   *
   * @returns True to fail the login on a hook error; false to log and continue.
   */
  protected isPostLoginFailureFatal(): boolean
  {
    return false;
  }

  /**
   * Discover, and remember for this process, the provider metadata and client
   * configuration for the masters client — the single client from environment
   * configuration, used for every login that is not per-organisation.
   *
   * Unlike {@link discoverForClient}, a failed promise is NOT evicted here, so a
   * discovery failure at startup persists until the process restarts.
   *
   * @returns The discovered masters-client configuration.
   * @throws When OIDC is not configured for this process.
   */
  protected async getDiscoveredConfig(): Promise<client.Configuration>
  {
    if (!this.config.enabled)
    {
      throw new Error("OIDC is not configured for this manager instance");
    }

    if (!this.discoveredConfig)
    {
      this.discoveredConfig = this.config.clientSecret
        ? client.discovery(new URL(this.config.issuerUrl), this.config.clientId, this.config.clientSecret)
        : client.discovery(new URL(this.config.issuerUrl), this.config.clientId);
    }

    return await this.discoveredConfig;
  }

  /**
   * Discover, and remember for this process, the OIDC configuration for one specific
   * client_id at the configured issuer. Used for per-organisation public clients, which
   * have no secret and therefore rely on PKCE.
   *
   * A failed discovery is removed from the cache before rethrowing, so a temporary
   * provider outage is retried on the next login instead of breaking that client for the
   * lifetime of the process.
   *
   * Called by: {@link completeLogin} (for the client_id recorded in the session) and
   * `OidcAuthService.resolveLoginClient` in
   * libs/backend/server/iam/identity/main/src/oidc.service.ts.
   *
   * @param clientId - The organisation's OIDC client_id, resolved from the request host.
   * @returns The discovered configuration for that client, ready to authorize against.
   * @throws When OIDC is disabled for this process, or when discovery fails — login is
   *         then unavailable for that client and the caller must not fall back silently.
   */
  protected async discoverForClient(clientId: string): Promise<client.Configuration>
  {
    if (!this.config.enabled)
    {
      throw new Error("OIDC is not configured for this manager instance");
    }

    let discovered = this.clientDiscovered.get(clientId);
    if (!discovered)
    {
      discovered = client.discovery(new URL(this.config.issuerUrl), clientId);
      this.clientDiscovered.set(clientId, discovered);
    }
    try
    {
      return await discovered;
    }
    catch (err)
    {
      this.clientDiscovered.delete(clientId);
      this.log.warn({ err, clientId }, "per-client OIDC discovery failed; login is unavailable for this client");
      throw err;
    }
  }

  /**
   * Build the IdP's `end_session_endpoint` URL with `id_token_hint` and (when configured)
   * `post_logout_redirect_uri`. Returns null when not applicable — never blocks local logout.
   */
  private async _buildEndSessionUrl(req: Request): Promise<string | null>
  {
    if (!this.config.enabled)
    {
      return null;
    }

    const idToken = req.session?.idToken;
    if (typeof idToken !== "string" || idToken === "")
    {
      return null;
    }

    try
    {
      const discoveredConfig = await this.getDiscoveredConfig();
      const metadata = discoveredConfig.serverMetadata();
      if (!metadata.end_session_endpoint)
      {
        return null;
      }

      const params: Record<string, string> = { id_token_hint: idToken };
      if (this.config.postLogoutRedirectUri)
      {
        params.post_logout_redirect_uri = _buildPostLogoutRedirectUri(req, this.config.postLogoutRedirectUri);
      }

      return client.buildEndSessionUrl(discoveredConfig, params).href;
    }
    catch (err)
    {
      this.log.warn({ err }, "failed to build OIDC end-session URL; logging out locally only");
      return null;
    }
  }

  /** Merge ID token claims with UserInfo claims when an access token is available. */
  private async _resolveClaims(
    discoveredConfig: client.Configuration,
    accessToken: string | undefined,
    claims: Record<string, unknown>,
  ): Promise<Record<string, unknown>>
  {
    if (!accessToken || typeof claims.sub !== "string")
    {
      return claims;
    }

    try
    {
      const userInfo = await client.fetchUserInfo(discoveredConfig, accessToken, claims.sub);
      return { ...claims, ...userInfo };
    }
    catch (err)
    {
      this.log.warn({ err }, "failed to fetch OIDC userinfo; continuing with ID token claims only");
      return claims;
    }
  }

  /**
   * Check the claims a login produced and convert them into the {@link AuthUser} stored
   * in the session.
   *
   * The checks, in order: there must be a `sub`; when either email allowlist is
   * configured there must be an email; an email the provider marked as NOT verified is
   * rejected outright; and the email must appear in the allowed-addresses list or its
   * domain in the allowed-domains list. Group and role claims are then turned into
   * `groups`, `isPlatformOperator`, and `isOrgAdmin` by {@link _ResolveIdentityClaims}.
   *
   * @param claims - The merged ID-token and UserInfo claims.
   * @returns The user to store in the session.
   * @throws When there is no usable subject, when an email is required but absent, when
   *         the email is not verified, or when it is outside the allowlists. Every one of
   *         these aborts the login and reaches the browser.
   */
  private _buildAuthUser(claims: Record<string, unknown>): AuthUser
  {
    const subject = typeof claims.sub === "string" ? claims.sub : "";
    if (!subject)
    {
      throw new Error("OIDC login succeeded without a usable subject claim");
    }

    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : undefined;
    const emailVerified = typeof claims.email_verified === "boolean" ? claims.email_verified : undefined;

    if ((this.config.allowedEmailDomains.length || this.config.allowedEmails.length) && !email)
    {
      throw new Error("An email claim is required for the configured OIDC allowlist");
    }

    if (emailVerified === false)
    {
      throw new Error("OIDC login was rejected because the email claim is not verified");
    }

    if (email && this.config.allowedEmails.length && !this.config.allowedEmails.includes(email))
    {
      const domain = email.split("@")[1] ?? "";
      if (!this.config.allowedEmailDomains.includes(domain))
      {
        throw new Error(`OIDC login is not allowed for ${email}`);
      }
    }

    if (email && !this.config.allowedEmails.length && this.config.allowedEmailDomains.length)
    {
      const domain = email.split("@")[1] ?? "";
      if (!this.config.allowedEmailDomains.includes(domain))
      {
        throw new Error(`OIDC login is not allowed for ${email}`);
      }
    }

    const identity = _ResolveIdentityClaims(claims, this.config, email);

    return {
      sub: subject,
      issuer: this.config.issuerUrl,
      groups: identity.groups,
      isPlatformOperator: identity.isPlatformOperator,
      isOrgAdmin: identity.isOrgAdmin,
      ...(email ? { email } : {}),
      ...(emailVerified !== undefined ? { emailVerified } : {}),
      ...(typeof claims.name === "string" ? { name: claims.name } : {}),
      ...(typeof claims.picture === "string" ? { picture: claims.picture } : {}),
      authenticatedAt: new Date().toISOString(),
    };
  }
}
