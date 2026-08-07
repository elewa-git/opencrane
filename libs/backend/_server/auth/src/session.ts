import { URL } from "node:url";

import type { Request } from "express";

import { _RequestHost } from "./request-host.js";
import type { AuthUser } from "./session.types.js";

export type { AuthUser } from "./session.types.js";

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
  if (!host) return configuredRedirect;
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
  if (!host) return configuredRedirect;
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

/** Limit return targets to local relative paths to prevent open redirects. */
export function _sanitizeReturnTo(returnTo: string | undefined): string
{
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//"))
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
