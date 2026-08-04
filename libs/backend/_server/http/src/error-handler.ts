import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";

/**
 * Detect a Prisma unique-constraint violation (P2002) WITHOUT importing a Prisma client.
 *
 * The Prisma client is application-owned, so this infrastructure library cannot import its
 * generated error class. Prisma known-request errors expose an `Error` name and string `code`;
 * duck-type that stable surface without coupling the HTTP layer to the generated package.
 *
 * @param err - The thrown error to classify.
 * @returns True when the error is a Prisma known-request error with code `P2002`.
 */
function _isPrismaUniqueViolation(err: unknown): boolean
{
  return (
    err instanceof Error &&
    err.name === "PrismaClientKnownRequestError" &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * OpenCrane server Express 5 global error handler.
 * Catches any error thrown from (or passed to `next()` by) a route handler — including the
 * authz gates' `.catch(next)` — and STRUCTURED-LOGS it before formatting the standard error
 * envelope. Register AFTER all routes so Express selects it only for errors.
 *
 * `detail` carries the raw error message in DEVELOPMENT only and is STRIPPED in production
 * (`NODE_ENV=production`) so Prisma messages, stack traces, and ORM internals never reach a
 * client there. Callers MUST always branch on `code`, never on a human message or `detail`.
 *
 * An unmapped Prisma unique-constraint violation (P2002) is a client conflict, not a server
 * error — return a clean 409 (no detail, any env) so the ORM message can never leak through
 * the generic 500 path. Routes SHOULD still catch P2002 themselves for a domain-specific
 * message (e.g. POST /cluster-tenants → "workspace name").
 *
 * @param log - Pino logger instance.
 */
export function _ErrorHandler(log: Logger)
{
  return function _handleError(err: unknown, req: Request, res: Response, _next: NextFunction): void
  {
    // The full error (incl. Prisma/stack) always goes to the server log — so a gate's
    // `.catch(next)` is never a silent failure.
    log.error({ err, url: req.url, method: req.method }, "unhandled request error");

    // Safety net: a Prisma P2002 a route did not map is a client conflict, not a 500.
    if (_isPrismaUniqueViolation(err))
    {
      res.status(409).json({ error: "A resource with these unique values already exists.", code: "CONFLICT" });
      return;
    }

    // Generic 500. `detail` is included in development only and STRIPPED in production.
    const body: Record<string, string> = { error: "An unexpected error occurred", code: "INTERNAL_ERROR" };
    if (process.env["NODE_ENV"] !== "production") body["detail"] = err instanceof Error ? err.message : String(err);
    res.status(500).json(body);
  };
}
