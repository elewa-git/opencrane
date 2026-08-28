import type { IncomingMessage } from "node:http";

import { describe, expect, it } from "vitest";

import { _CreateOrganizationProductAccessMiddleware } from "@opencrane/backend/server/iam/organization-members";

import { _CreateConversationSocketAuthenticator, __IsSameOriginConversationSocketRequest } from "../conversation-socket-authenticator";

/** Builds the raw upgrade facts that the same-origin policy reads. */
function _UpgradeRequest(headers: Record<string, string>, encrypted = false): IncomingMessage
{
	return { headers, socket: { encrypted } } as unknown as IncomingMessage;
}

describe("conversation socket origin policy", function _OriginPolicy()
{
	it("requires the public protocol as well as the public host", function _ExactOrigin()
	{
		expect(__IsSameOriginConversationSocketRequest(_UpgradeRequest({ host: "tenant.example", origin: "https://tenant.example", "x-forwarded-proto": "https" }))).toBe(true);
		expect(__IsSameOriginConversationSocketRequest(_UpgradeRequest({ host: "tenant.example", origin: "http://tenant.example", "x-forwarded-proto": "https" }))).toBe(false);
	});

	it("uses the trusted forwarded host and protocol behind the ingress", function _ForwardedOrigin()
	{
		expect(__IsSameOriginConversationSocketRequest(_UpgradeRequest({ host: "opencrane-server:8080", origin: "https://tenant.example", "x-forwarded-host": "tenant.example", "x-forwarded-proto": "https" }))).toBe(true);
		expect(__IsSameOriginConversationSocketRequest(_UpgradeRequest({ host: "opencrane-server:8080", origin: "https://tenant.example", "x-forwarded-host": "tenant.example", "x-forwarded-proto": "http" }))).toBe(false);
	});
});

describe("conversation socket authentication", function _Authentication()
{
	it("runs principal admission after restoring the signed browser session", async function _Admit()
	{
		const request = _UpgradeRequest({ host: "silo-1.example", origin: "https://silo-1.example", "x-forwarded-proto": "https" });
		request.url = "/api/v1/me/conversations/conversation-1/socket";
		const authenticator = _CreateConversationSocketAuthenticator([
			function _Session(req, _res, next) { (req as unknown as { session: unknown }).session = { authUser: { sub: "subject-1" } }; next(); },
		], function _Admission(req, _res, next)
		{
			req.authenticatedPrincipal = { principalId: "principal-1", siloId: "silo-1", issuer: "https://issuer.example", subject: "subject-1" };
			next();
		}, null);
		expect(await authenticator.authenticate(request)).toEqual({ siloId: "silo-1", issuer: "https://issuer.example", subjectId: "subject-1" });
	});

	it("fails closed when product principal admission rejects the restored session", async function _Reject()
	{
		const request = _UpgradeRequest({ host: "silo-1.example", origin: "https://silo-1.example", "x-forwarded-proto": "https" });
		request.url = "/api/v1/me/conversations/conversation-1/socket";
		const authenticator = _CreateConversationSocketAuthenticator([
			function _Session(_req, _res, next) { next(); },
		], function _Reject(_req, res) { res.status(401).json({ error: "authentication_required" }); }, null);
		expect(await authenticator.authenticate(request)).toBeNull();
	});

	it("rejects a suspended standalone member after principal admission", async function _RejectSuspendedMember()
	{
		const request = _UpgradeRequest({ host: "silo-1.example", origin: "https://silo-1.example", "x-forwarded-proto": "https" });
		request.url = "/api/v1/me/conversations/conversation-1/socket";
		const membership = { hasActiveMembership: async function _HasActiveMembership() { return false; } } as unknown as Parameters<typeof _CreateOrganizationProductAccessMiddleware>[0];
		const productAccess = _CreateOrganizationProductAccessMiddleware(membership, function _ResolveCaller()
		{
			return { siloId: "silo-1", subjectId: "subject-1", verifiedEmail: null, displayName: "Tier 3 Owner" };
		});
		const authenticator = _CreateConversationSocketAuthenticator([
			function _Session(_req, _res, next) { next(); },
		], function _Admission(req, _res, next)
		{
			req.authenticatedPrincipal = { principalId: "principal-1", siloId: "silo-1", issuer: "https://issuer.example", subject: "subject-1" };
			next();
		}, productAccess);

		expect(await authenticator.authenticate(request)).toBeNull();
	});
});
