import { URL } from "node:url";

import type { Request } from "express";

import { _RequestHost } from "./request-host";
import type { AuthUser } from "./session.types";

export type { AuthUser } from "./session.types";

/**
 * Build the OIDC redirect_uri for THIS request's host (multi-host). Each org/host is served
 * at its own host, so login/callback must happen there for the session cookie to be
 * host-scoped to it. We take the callback PATH from the configured `OIDC_REDIRECT_URI`
 * (operator-controlled) but derive the ORIGIN from the request — the same origin
 * `completeLogin` sees at the callback, so the auth-request and token-exchange redirect_uri
 * always match. Falls back to the configured URI when the request carries no host.
 */
export function _buildRedirectUri(req: Request, configuredRedirect: string): string
{
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string" ? forwardedProto.split(",")[0].trim() : req.protocol;
  const host = _RequestHost(req);
	if (!host)
		return configuredRedirect;
  const callbackPath = new URL(configuredRedirect).pathname;
  return `${protocol}://${host}${callbackPath}`;
}

/**
 * Build the `post_logout_redirect_uri` for THIS request's host. Same multi-host rule as
 * {@link _buildRedirectUri}: take the PATH from the configured URI but derive the ORIGIN
 * from the request. Falls back to the configured URI when no host is present.
 */
export function _buildPostLogoutRedirectUri(req: Request, configuredRedirect: string): string
{
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string" ? forwardedProto.split(",")[0].trim() : req.protocol;
  const host = _RequestHost(req);
	if (!host)
		return configuredRedirect;
  const parsed = new URL(configuredRedirect);
  return `${protocol}://${host}${parsed.pathname}${parsed.search}`;
}

/** Convert the current Express request into an absolute callback URL. */
export function _buildCurrentUrl(req: Request): URL
{
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string" ? forwardedProto.split(",")[0].trim() : req.protocol;
  const host = _RequestHost(req);

  return new URL(`${protocol}://${host}${req.originalUrl}`);
}

/**
 * Reduces a post-login return target to something safe to redirect to.
 *
 * Only a path starting with a single `/` and containing no backslash or ASCII control character
 * is kept. Browsers can normalize backslashes into authority separators and strip controls before
 * navigation, so those inputs are unsafe even when the raw string does not start with `//`.
 *
 * Called by: `OidcAuthServiceBase`, `Tier3DevelopmentAuthService`, and the Tier 3 router. The
 * services sanitize browser input, and the router checks the service result again before writing
 * the `Location` header.
 *
 * @param returnTo - Candidate return path from browser input or an authentication service.
 * @returns A local path safe to redirect to; `/` when the input was not one.
 */
export function _sanitizeReturnTo(returnTo: string | undefined): string
{
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//") || /[\\\u0000-\u001F\u007F]/u.test(returnTo))
  {
    return "/";
  }

  return returnTo;
}

/** Persist the current session mutation before redirecting. */
export function _saveSession(req: Request): Promise<void>
{
  return new Promise<void>((resolve, reject) =>
  {
    req.session.save(err =>
    {
      if (err)
      {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

/** Regenerate the session identifier after login to prevent fixation. */
export function _regenerateSession(req: Request): Promise<void>
{
  return new Promise<void>((resolve, reject) =>
  {
    req.session.regenerate(err =>
    {
      if (err)
      {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

/** Destroy the current session and clear its cookie. */
export function _destroySession(req: Request): Promise<void>
{
  return new Promise<void>((resolve, reject) =>
  {
    req.session.destroy(err =>
    {
      if (err)
      {
        reject(err);
        return;
      }

      resolve();
    });
  });
}
