import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { ___AuthRouter } from "../auth.router.js";

/** Mount auth routes with a server-owned session double. */
function _App(authService: object, authenticated: boolean)
{
	const app = express();
	app.use(function _Session(req, _res, next)
	{
		req.session = authenticated ? { authUser: { sub: "user-1" } } as never : {} as never;
		next();
	});
	app.use("/api/v1/auth", ___AuthRouter(authService as never, {} as never));
	return app;
}

describe("OIDC reauthentication route", function _Suite()
{
	it("forces prompt=login and retains only a local return path", async function _ForcesLogin()
	{
		const buildLoginUrl = vi.fn().mockResolvedValue("https://identity.example.test/authorize");
		const service = { isEnabled: function _Enabled() { return true; }, buildLoginUrl, getStatus: vi.fn(), completeLogin: vi.fn(), logout: vi.fn() };
		const response = await request(_App(service, true)).get("/api/v1/auth/reauthenticate?returnTo=%2Fworkspace%2Fconversation-1");
		expect(response.status).toBe(302);
		expect(buildLoginUrl).toHaveBeenCalledWith(expect.anything(), "/workspace/conversation-1", { prompt: "login" });
	});

	it("requires an existing authenticated session", async function _RequiresSession()
	{
		const buildLoginUrl = vi.fn();
		const service = { isEnabled: function _Enabled() { return true; }, buildLoginUrl, getStatus: vi.fn(), completeLogin: vi.fn(), logout: vi.fn() };
		const response = await request(_App(service, false)).get("/api/v1/auth/reauthenticate");
		expect(response.status).toBe(401);
		expect(buildLoginUrl).not.toHaveBeenCalled();
	});
});
