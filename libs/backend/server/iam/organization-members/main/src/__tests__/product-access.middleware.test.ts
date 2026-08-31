import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { OrganizationMembershipCaller } from "../authority.types";
import type { OrganizationMemberRepository } from "../organization-member-repository.types";
import { _CreateOrganizationProductAccessMiddleware } from "../product-access.middleware";

/** Authenticated identity used by the product-access boundary. */
const _CALLER: OrganizationMembershipCaller = { siloId: "acme", principalId: "principal-invitee-1", subjectId: "invitee-1", verifiedEmail: "new@acme.test", displayName: "Invitee" };

/** Builds an app whose acceptance handler makes the following request an active member. */
function _app(initiallyActive: boolean, failure?: Error)
{
	let active = initiallyActive;
	const hasActiveMembership = vi.fn(async function _HasActiveMembership(caller: Pick<OrganizationMembershipCaller, "siloId" | "subjectId">): Promise<boolean>
	{
		if (failure !== undefined) throw failure;
		return active && caller.siloId === "acme" && caller.subjectId === "invitee-1";
	});
	const repository = { hasActiveMembership } as unknown as OrganizationMemberRepository;
	const app = express();
	app.use(express.json());
	app.use(_CreateOrganizationProductAccessMiddleware(repository, function _ResolveCaller() { return _CALLER; }));
	app.post("/api/v1/organization/members/invitations/accept", function _Accept(_request: Request, response: Response) { active = true; response.json({ accepted: true }); });
	app.post("/api/v1/me/onboarding/chat/start", function _Start(_request: Request, response: Response) { response.json({ started: true }); });
	app.use(function _Error(error: Error, _request: Request, response: Response, _next: NextFunction) { response.status(500).json({ error: error.message }); });
	return { app, hasActiveMembership };
}

describe("standalone product membership access", function _Suite()
{
	it("allows only invitation acceptance before membership and unlocks the next request", async function _AcceptanceUnlocksProduct()
	{
		const { app } = _app(false);

		await request(app).post("/api/v1/me/onboarding/chat/start").expect(403);
		await request(app).post("/api/v1/organization/members/invitations/accept").send({ token: "opaque" }).expect(200);
		await request(app).post("/api/v1/me/onboarding/chat/start").expect(200);
	});

	it("permits an existing active member", async function _ActiveMember()
	{
		await request(_app(true).app).post("/api/v1/me/onboarding/chat/start").expect(200);
	});

	it("fails closed when membership is missing, cross-silo, suspended, or unavailable", async function _DeniedMembership()
	{
		const missing = _app(false);
		await request(missing.app).post("/api/v1/me/onboarding/chat/start").expect(403);
		expect(missing.hasActiveMembership).toHaveBeenCalledWith({ siloId: "acme", principalId: "principal-invitee-1", subjectId: "invitee-1", verifiedEmail: "new@acme.test", displayName: "Invitee" });
		await request(_app(false, new Error("database unavailable")).app).post("/api/v1/me/onboarding/chat/start").expect(500, { error: "database unavailable" });
	});
});
