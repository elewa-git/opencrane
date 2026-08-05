import type { NextFunction, Request, Response } from "express";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { _ErrorHandler } from "../error-handler.js";

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
});
