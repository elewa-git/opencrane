import express, { type NextFunction, type Request, type Response } from "express";
import pino from "pino";
import type { Logger } from "pino";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiValidationIssueLocations } from "@opencrane/contracts";
import { _ErrorHandler } from "../error-handler.js";
import { _RequestValidationProblem } from "../request-validation.js";

const log = pino({ level: "silent" });

/** A minimal Response stub recording the status + JSON body the handler emits. */
function _mockRes(): { res: Response; sent: { status?: number; body?: Record<string, unknown> } }
{
  const sent: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) { sent.status = code; return this; },
    json(body: Record<string, unknown>) { sent.body = body; return this; },
  } as unknown as Response;
  return { res, sent };
}

/**
 * Fabricate a Prisma known-request error WITHOUT importing a Prisma client — the handler
 * duck-types on `name === "PrismaClientKnownRequestError"` plus `code`. Testing the structural
 * contract rather than the generated class keeps the infrastructure library Prisma-free.
 */
function _prismaError(code: string, message: string): Error
{
  return Object.assign(new Error(message), { name: "PrismaClientKnownRequestError", code });
}

const req = { url: "/x", method: "POST" } as Request;
const next = (() => {}) as NextFunction;

describe("_ErrorHandler", function _suite()
{
  afterEach(() => { delete process.env["NODE_ENV"]; vi.restoreAllMocks(); });

  it("maps an unmapped Prisma P2002 to 409 CONFLICT with no leaked detail (any env)", function _p2002()
  {
    process.env["NODE_ENV"] = "production";
    const { res, sent } = _mockRes();
    const err = _prismaError("P2002", "Unique constraint failed on the fields: (`name`)");

    _ErrorHandler(log)(err, req, res, next);

    expect(sent.status).toBe(409);
    expect(sent.body).toEqual({ error: "A resource with these unique values already exists.", code: "CONFLICT" });
    expect(JSON.stringify(sent.body)).not.toMatch(/Unique constraint|P2002/);
  });

  it("does NOT treat a non-P2002 Prisma error as a conflict", function _otherCode()
  {
    const { res, sent } = _mockRes();
    _ErrorHandler(log)(_prismaError("P2025", "record not found"), req, res, next);
    expect(sent.status).toBe(500);
  });

  it("strips detail from a generic 500 in production", function _prodStrip()
  {
    process.env["NODE_ENV"] = "production";
    const { res, sent } = _mockRes();

    _ErrorHandler(log)(new Error("boom: secret internals"), req, res, next);

    expect(sent.status).toBe(500);
    expect(sent.body).toEqual({ error: "An unexpected error occurred", code: "INTERNAL_ERROR" });
    expect(sent.body).not.toHaveProperty("detail");
  });

  it("includes detail on a generic 500 outside production (debugging aid)", function _devDetail()
  {
    process.env["NODE_ENV"] = "development";
    const { res, sent } = _mockRes();

    _ErrorHandler(log)(new Error("boom"), req, res, next);

    expect(sent.status).toBe(500);
    expect(sent.body?.["detail"]).toBe("boom");
  });

	it("returns bounded field issues only for the dedicated public validation problem", function _publicValidation()
	{
		const { res, sent } = _mockRes();
		const err = new _RequestValidationProblem([{ location: ApiValidationIssueLocations.Body, path: ["profile", "email"], message: "This field has an invalid format." }]);

		_ErrorHandler(log)(err, req, res, next);

		expect(sent.status).toBe(400);
		expect(sent.body).toEqual({
			error: "Request validation failed.",
			code: "VALIDATION_ERROR",
			issues: [{ location: "body", path: ["profile", "email"], message: "This field has an invalid format." }],
		});
	});

	it("keeps an unrelated ZodError opaque on the internal-error path in every environment", function _internalZodError()
	{
		process.env["NODE_ENV"] = "development";
		const { res, sent } = _mockRes();
		const parsed = z.object({ secret: z.string() }).safeParse({});
		if (parsed.success)
		{
			throw new Error("Expected the test schema to reject its input.");
		}

		_ErrorHandler(log)(parsed.error, req, res, next);

		expect(sent.status).toBe(500);
		expect(sent.body).toEqual({ error: "An unexpected error occurred", code: "INTERNAL_ERROR" });
	});

	it("maps malformed JSON without logging body-parser's retained request body", async function _malformedJson()
	{
		const warn = vi.fn();
		const error = vi.fn();
		const app = express();
		app.use(express.json());
		app.post("/json", function _acceptJson(_request, response)
		{
			response.json({ accepted: true });
		});
		app.use(_ErrorHandler({ warn, error } as unknown as Logger));

		const response = await request(app).post("/json?token=top-secret-query").set("Content-Type", "application/json").send('{"password":"top-secret-body",');

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "Request body must contain valid JSON.", code: "MALFORMED_JSON" });
		expect(JSON.stringify(warn.mock.calls)).not.toContain("top-secret-body");
		expect(JSON.stringify(warn.mock.calls)).not.toContain("top-secret-query");
		expect(error).not.toHaveBeenCalled();
	});
});
