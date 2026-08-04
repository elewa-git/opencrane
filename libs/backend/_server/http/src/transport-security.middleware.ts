import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * HSTS policy emitted on HTTPS responses: two years, all subdomains, preload-eligible.
 * @see https://www.rfc-editor.org/rfc/rfc6797 (HTTP Strict Transport Security)
 */
const _HSTS_VALUE = "max-age=63072000; includeSubDomains; preload";

/**
 * Transport-security middleware: advertise HSTS on secure responses and,
 * optionally, redirect plain-HTTP requests to HTTPS.
 *
 * TLS terminates at the ingress, so `req.secure` reflects the `X-Forwarded-Proto`
 * header (the app sets `trust proxy`). HSTS is only meaningful over HTTPS, so it is
 * emitted only on secure requests. The HTTP→HTTPS redirect is opt-in via
 * `OPENCRANE_FORCE_HTTPS` (default off) because the ingress normally performs it and
 * an always-on redirect would 3xx internal plain-HTTP health probes; when enabled it
 * only redirects safe (GET/HEAD) methods.
 *
 * @returns Express request handler enforcing the transport-security posture.
 */
export function _TransportSecurity(): RequestHandler
{
  const forceHttps = ["1", "true", "yes", "on"].includes((process.env.OPENCRANE_FORCE_HTTPS ?? "").trim().toLowerCase());

  /**
   * Per-request handler: set HSTS on secure responses, optionally redirect to HTTPS.
   * @param req  - The incoming HTTP request.
   * @param res  - The HTTP response.
   * @param next - Pass control to the next middleware.
   */
  return function _transportSecurity(req: Request, res: Response, next: NextFunction): void
  {
    // 1. Secure request — advertise HSTS so the browser pins HTTPS for future visits.
    if (req.secure)
    {
      res.setHeader("Strict-Transport-Security", _HSTS_VALUE);
      next();
      return;
    }

    // 2. Plain HTTP with redirect enabled — bounce safe methods to the HTTPS origin.
    //    Use `req.hostname` (trust-proxy-normalised) rather than the raw Host header
    //    so a spoofed Host cannot turn this into an open redirect.
    if (forceHttps && (req.method === "GET" || req.method === "HEAD"))
    {
      res.redirect(308, `https://${req.hostname}${req.originalUrl}`);
      return;
    }

    // 3. Plain HTTP otherwise — pass through (ingress is expected to enforce TLS).
    next();
  };
}
