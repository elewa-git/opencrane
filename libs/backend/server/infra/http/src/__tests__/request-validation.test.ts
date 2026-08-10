import express from "express";
import type { Logger } from "pino";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { _ErrorHandler } from "../error-handler.js";
import { ___WithValidatedPublicBody } from "../request-validation.js";

/** Build a test app whose public route uses the shared validation boundary. */
function _BuildApp()
{
	const app = express();
	const log = { warn: vi.fn(), error: vi.fn() } as unknown as Logger;
	const schema = z.object({
		profile: z.object({
			email: z.string().email(),
			displayName: z.string().transform(function _TrimDisplayName(value): string { return value.trim(); }),
		}),
	}).strict();
	app.use(express.json());
	app.post("/profile", ___WithValidatedPublicBody(schema, async function _saveProfile(_request, response, _next, body)
	{
		response.json(body);
	}));
	app.use(_ErrorHandler(log));
	return app;
}

describe("___WithValidatedPublicBody", function _Suite()
{
	it("returns safe nested field paths without echoing rejected values", async function _RejectInvalidBody()
	{
		const response = await request(_BuildApp()).post("/profile").send({ profile: { email: "private-invalid-value", displayName: "Jente" } });

		expect(response.status).toBe(400);
		expect(response.body).toEqual({
			error: "Request validation failed.",
			code: "VALIDATION_ERROR",
			issues: [{ location: "body", path: ["profile", "email"], message: "This field has an invalid format." }],
		});
		expect(JSON.stringify(response.body)).not.toContain("private-invalid-value");
	});

	it("passes the parsed model to the route instead of the untrusted body", async function _PassParsedBody()
	{
		const response = await request(_BuildApp()).post("/profile").send({ profile: { email: "jente@example.test", displayName: "  Jente  " } });

		expect(response.status).toBe(200);
		expect(response.body.profile.displayName).toBe("Jente");
	});

	it("identifies an unrecognized field without returning its value", async function _RejectUnknownField()
	{
		const response = await request(_BuildApp()).post("/profile").send({
			profile: { email: "jente@example.test", displayName: "Jente" },
			unexpected: "private-value",
		});

		expect(response.status).toBe(400);
		expect(response.body.issues).toEqual([{ location: "body", path: ["unexpected"], message: "The request contains unrecognized fields." }]);
		expect(JSON.stringify(response.body)).not.toContain("private-value");
	});
});
