import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { OrganizationMembershipAuthority } from "../authority.types";
import { OrganizationMembershipError, OrganizationMembershipErrorKinds } from "../organization-members.errors";
import { _CreateOrganizationMembersRouter } from "../organization-members.router";

/** Verified caller supplied by the application composition boundary. */
const _CALLER = { siloId: "acme", principalId: "principal-member-1", subjectId: "member-1", verifiedEmail: "member@acme.test", displayName: "Member" };

/** Creates an acceptance route whose authority refuses with one stable domain error. */
function _app(kind: OrganizationMembershipErrorKinds)
{
	const authority = {
		directory: vi.fn(),
		validate: vi.fn(),
		create: vi.fn(),
		resend: vi.fn(),
		accept: vi.fn(async function _Accept(): Promise<never> { throw new OrganizationMembershipError(kind, "invitation refused"); }),
	} satisfies OrganizationMembershipAuthority;
	const app = express();
	app.use(express.json());
	app.use(_CreateOrganizationMembersRouter(authority, function _ResolveCaller() { return _CALLER; }));
	return app;
}

describe("organization member router error contract", function _Suite()
{
	it("returns the shared API envelope for an already-used invitation", async function _AlreadyUsed()
	{
		const response = await request(_app(OrganizationMembershipErrorKinds.AlreadyUsed)).post("/invitations/accept").send({ token: "a".repeat(32) }).expect(409);
		expect(response.body).toEqual({ error: "invitation refused", code: "already_used" });
	});

	it("returns the shared API envelope for a verified identity mismatch", async function _IdentityMismatch()
	{
		const response = await request(_app(OrganizationMembershipErrorKinds.IdentityMismatch)).post("/invitations/accept").send({ token: "a".repeat(32) }).expect(422);
		expect(response.body).toEqual({ error: "invitation refused", code: "identity_mismatch" });
	});

	it("uses the same envelope for request validation failures", async function _InvalidBody()
	{
		const response = await request(_app(OrganizationMembershipErrorKinds.AlreadyUsed)).post("/invitations/accept").send({ token: "short" }).expect(400);
		expect(response.body).toEqual({ error: "request body is invalid", code: "invalid" });
	});
});
