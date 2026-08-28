import { Router } from "express";

import type { Tier3DevelopmentAuthService } from "./development-auth.service";

/**
 * Mounts the browser-session routes for the installation's fixed Tier 3 identity.
 *
 * Login stays public because proxy proof creates the first session. Reauthentication requires an
 * existing session, the callback returns 503 because this mode has no OIDC redirect, and logout
 * destroys the local session without returning an upstream URL.
 *
 * Called by: `_CreateTier3DevelopmentAuthentication` when startup selects `tier3-development`.
 * @param authService - Verifies proxy proof, admits the installed identity, and manages its session.
 * @returns An Express router for status, login, reauthentication, callback refusal, and logout.
 */
export function ___Tier3DevelopmentAuthRouter(authService: Tier3DevelopmentAuthService): Router
{
	const router = Router();
	router.get("/me", async function _ReadSession(request, response, next): Promise<void>
	{
		try
		{
			response.json(await authService.getStatus(request));
		}
		catch (error)
		{
			next(error);
		}
	});
	router.get("/login", async function _Login(request, response, next): Promise<void>
	{
		try
		{
			if (request.query.prompt !== undefined)
			{
				response.status(400).json({ error: "Registration prompts require OIDC.", code: "UNSUPPORTED_LOGIN_PROMPT" });
				return;
			}
			const returnTo = typeof request.query.returnTo === "string" ? request.query.returnTo : "/";
			const target = await authService.login(request, returnTo);
			if (target === null)
			{
				response.status(403).json({ error: "Tier 3 proxy proof required", code: "TIER3_PROXY_PROOF_REQUIRED" });
				return;
			}
			response.redirect(302, target);
		}
		catch (error)
		{
			next(error);
		}
	});
	router.get("/reauthenticate", async function _Reauthenticate(request, response, next): Promise<void>
	{
		try
		{
			if (!(await authService.getStatus(request)).authenticated)
			{
				response.status(401).json({ error: "authentication_required" });
				return;
			}
			const returnTo = typeof request.query.returnTo === "string" ? request.query.returnTo : "/";
			const target = await authService.login(request, returnTo);
			if (target === null)
			{
				response.status(403).json({ error: "Tier 3 proxy proof required", code: "TIER3_PROXY_PROOF_REQUIRED" });
				return;
			}
			response.redirect(302, target);
		}
		catch (error)
		{
			next(error);
		}
	});
	router.get("/callback", function _RejectOidcCallback(_request, response): void
	{
		response.status(503).json({ error: "OIDC is not configured for Tier 3 development authentication" });
	});
	router.post("/logout", async function _Logout(request, response, next): Promise<void>
	{
		try
		{
			await authService.logout(request);
			response.status(200).json({ endSessionUrl: null });
		}
		catch (error)
		{
			next(error);
		}
	});
	return router;
}
