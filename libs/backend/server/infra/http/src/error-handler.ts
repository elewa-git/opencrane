import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";
import { ZodError } from "zod";

import { _RequestValidationProblem } from "./request-validation";

/** Body-parser failure shape emitted by Express when a JSON document cannot be parsed. */
interface MalformedJsonError extends SyntaxError
{
	/** Stable body-parser category. */
	readonly type: "entity.parse.failed";
}

/** External body-parser category for invalid JSON syntax. */
const _MALFORMED_JSON_ERROR_TYPE = "entity.parse.failed";

/** External body-parser category for a request larger than its route-owned ceiling. */
const _PAYLOAD_TOO_LARGE_ERROR_TYPE = "entity.too.large";

/** Return whether Express rejected the request before route-level body validation. */
function _IsMalformedJson(err: unknown): err is MalformedJsonError
{
	return err instanceof SyntaxError && (err as { type?: unknown }).type === _MALFORMED_JSON_ERROR_TYPE;
}

/** Return whether Express rejected the request before retaining an oversized caller body. */
function _IsPayloadTooLarge(err: unknown): boolean
{
	return err instanceof Error && (err as { type?: unknown }).type === _PAYLOAD_TOO_LARGE_ERROR_TYPE;
}

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
 * authz gates' `.catch(next)` — classifies it before structured logging and formatting the standard
 * error envelope. Expected request failures log bounded metadata; unknown internal failures retain
 * their full diagnostic. Register AFTER all routes so Express selects it only for errors.
 *
 * `detail` carries the raw error message in DEVELOPMENT only and is STRIPPED in production
 * (`NODE_ENV=production`) so Prisma messages, stack traces, and ORM internals never reach a client
 * there. Internal Zod failures never expose detail in either mode. Callers MUST always branch on
 * `code`, never on a human message or `detail`.
 *
 * An unmapped Prisma unique-constraint violation (P2002) is a client conflict, not a server
 * error — return a clean 409 (no detail, any env) so the ORM message can never leak through
 * the generic 500 path. Routes SHOULD still catch P2002 themselves for a domain-specific
 * message (e.g. POST /cluster-tenants → "workspace name").
 *
 * Called by: apps/opencrane/src/app/public-app.ts and internal-app.ts, each as the final `app.use`.
 *
 * @param log - Pino logger instance.
 * @returns The Express 5 error middleware. Register it after every route, or Express will not select
 *   it for errors.
 */
export function _ErrorHandler(log: Logger)
{
	return function _handleError(err: unknown, req: Request, res: Response, _next: NextFunction): void
	{
		// 1. Oversized bodies can retain caller-controlled bytes on the parser error, so record only
		//    the bounded request category and route metadata.
		if (_IsPayloadTooLarge(err))
		{
			log.warn({ code: "PAYLOAD_TOO_LARGE", path: req.path, method: req.method }, "request body exceeded its route limit");
			res.status(413).json({ error: "Request body is too large.", code: "PAYLOAD_TOO_LARGE" });
			return;
		}

		// 2. Malformed JSON is rejected before Zod runs. Log only the category because body-parser's
		//    error object may retain the caller-controlled raw body.
		if (_IsMalformedJson(err))
		{
			log.warn({ code: "MALFORMED_JSON", path: req.path, method: req.method }, "malformed JSON request");
			res.status(400).json({ error: "Request body must contain valid JSON.", code: "MALFORMED_JSON" });
			return;
		}

		// 3. Only the dedicated public request wrapper may turn Zod diagnostics into a client error.
		//    A ZodError from internal state remains an internal error and cannot disclose its shape.
		if (err instanceof _RequestValidationProblem)
		{
			log.warn({ code: "VALIDATION_ERROR", issueCount: err.issues.length, path: req.path, method: req.method }, "request validation failed");
			res.status(400).json({ error: "Request validation failed.", code: "VALIDATION_ERROR", issues: err.issues });
			return;
		}

		// 4. An unmapped Prisma uniqueness failure is an expected public conflict. Retain the full
		//    diagnostic only in internal logs; the client receives the fixed envelope below.
		if (_isPrismaUniqueViolation(err))
		{
			log.warn({ err, path: req.path, method: req.method }, "unmapped unique constraint conflict");
			res.status(409).json({ error: "A resource with these unique values already exists.", code: "CONFLICT" });
			return;
		}

		// 5. Unknown failures are logged with their diagnostic and stay generic in production.
		log.error({ err, path: req.path, method: req.method }, "unhandled request error");
		const body: Record<string, string> = { error: "An unexpected error occurred", code: "INTERNAL_ERROR" };
		if (process.env["NODE_ENV"] !== "production" && !(err instanceof ZodError))
		{
			body["detail"] = err instanceof Error ? err.message : String(err);
		}
		res.status(500).json(body);
	};
}
