import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";

import type { RateLimitOptions } from "./rate-limit.types.js";

export type { RateLimitOptions } from "./rate-limit.types.js";

/**
 * Per-IP request rate limiter for the OpenCrane API server. Mounted once, early in the
 * middleware chain so every authorization-gated or database-backed endpoint is covered
 * — a DoS backstop that also satisfies the `js/missing-rate-limiting` scanning rule.
 *
 * The default cap is deliberately generous (1000/min/IP): real opencrane-ui traffic stays well
 * under it, so this never shapes normal use — it only sheds a flood. Health probes (`/healthz`,
 * `/readyz`) and the high-frequency trusted internal pod-poll surface (`/api/internal/*`) are
 * exempt so liveness checks and operator loops are never throttled.
 *
 * @param opts - Optional window/max overrides.
 * @returns An Express middleware enforcing the per-IP limit.
 */
export function _RateLimit(opts?: RateLimitOptions): RequestHandler
{
  return rateLimit({
    windowMs: opts?.windowMs ?? 60_000,
    limit: opts?.max ?? 1000,
    standardHeaders: true,
    legacyHeaders: false,
    // The server sets `trust proxy` deliberately (a single ingress fronts every request) so
    // `req.ip` is the forwarded client. Silence express-rate-limit's permissive-trust-proxy
    // validation — it would otherwise log a non-JSON console warning on first request, which
    // pollutes the stdout-scraped log stream.
    validate: { trustProxy: false },
    skip: function _skip(req): boolean
    {
      return req.path === "/healthz"
        || req.path === "/readyz"
        || req.path.startsWith("/api/internal");
    },
  });
}
