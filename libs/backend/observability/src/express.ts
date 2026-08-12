/**
 * Express middleware that seeds the per-request {@link RequestContext}.
 *
 * Structurally typed (no `express` import) so it works on both the Express 5
 * opencrane-ui and the Express 4 feat-skill-registry without coupling the lib to a
 * framework version.
 */
import { randomUUID } from "node:crypto";

import { ___RunWithContext } from "./context.js";

/** Minimal request shape this middleware reads from. */
interface _MinimalRequest
{
  /** Incoming HTTP headers (used to honour an inbound `x-request-id`). */
  headers: Record<string, string | string[] | undefined>;
  /** HTTP method, surfaced as a context field. */
  method?: string;
  /** Routed path, surfaced as a context field. */
  path?: string;
}

/** Minimal response shape this middleware writes the echoed id to. */
interface _MinimalResponse
{
  /** Sets a response header. */
  setHeader(name: string, value: string): void;
}

/**
 * Build the middleware that gives every request a correlation id.
 *
 * Mount it before any route that logs, because a log line emitted outside this context carries no
 * `requestId`. It reuses an inbound `x-request-id` when a caller or proxy sends one, so one id can
 * span several services, and mints a UUID otherwise. The id is echoed on the response and
 * installed as the active context for the rest of the handler chain.
 *
 * The inbound header is trusted as-is and used only for correlation — never treat it as identity.
 *
 * Called by: `apps/opencrane/src/app/public-app.ts`, `apps/opencrane/src/app/internal-app.ts`.
 * @returns An Express-compatible request handler.
 * @see {@link ___RunWithContext}
 * @see https://www.rfc-editor.org/rfc/rfc6648
 */
export function ___RequestContext(): (req: _MinimalRequest, res: _MinimalResponse, next: () => void) => void
{
  return function _requestContext(req: _MinimalRequest, res: _MinimalResponse, next: () => void): void
  {
    // 1. Reuse an inbound correlation id when present so traces stitch across
    //    service hops; fall back to a fresh UUID for edge requests.
    const header = req.headers["x-request-id"];
    const inbound = Array.isArray(header) ? header[0] : header;
    const requestId = inbound && inbound.length > 0 ? inbound : randomUUID();

    // 2. Echo the id so clients (and downstream logs) can correlate.
    //    x-request-id: de-facto standard correlation header (RFC 6648 X- prefix);
    //    consumers use it to tie a client-side error back to server logs.
    //    @see https://www.rfc-editor.org/rfc/rfc6648
    res.setHeader("x-request-id", requestId);

    // 3. Install the context for the remainder of the handler chain so every
    //    downstream log line inherits requestId/method/path automatically.
    ___RunWithContext({ requestId, extra: { method: req.method, path: req.path } }, next);
  };
}
