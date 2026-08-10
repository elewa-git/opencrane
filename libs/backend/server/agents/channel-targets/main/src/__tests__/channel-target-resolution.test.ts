import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ChannelTargetResolutionDependencies, IssueChannelInvocationContextCommand } from "../channel-target-resolution.types.js";
import { __ResolveChannelTarget } from "../channel-target-resolution.js";

/** Stable test instant. */
const _NOW = Date.parse("2026-07-18T12:00:00.000Z");
/** Valid authorization evidence digest. */
const _AUTHORIZATION_DIGEST = `sha256:${"b".repeat(64)}`;
/** Opaque 256-bit-like test context. */
const _OPAQUE_CONTEXT = "a".repeat(43);

/** Builds fully trusted dependencies with focused override seams. */
function _dependencies(): ChannelTargetResolutionDependencies
{
	return {
		config: { workloadAudience: "opencrane", channelProxyServiceAccountName: "channel-proxy", channelProxyNamespace: "silo-acme", invocationContextTtlMs: 60_000, allowedRouteHostSuffixes: [".svc.cluster.local"] },
		workloadIdentity: { review: async function _review() { return { outcome: "trusted", identity: { username: "system:serviceaccount:silo-acme:channel-proxy", serviceAccountName: "channel-proxy", namespace: "silo-acme", audiences: ["opencrane"] } }; } },
		delegatedIdentity: {
			resolveCookie: async function _resolveCookie() { return { outcome: "trusted", identity: { subjectId: "user-1", source: "cookie", trustworthySubject: true } }; },
			resolveBearer: async function _resolveBearer() { return { outcome: "trusted", identity: { subjectId: "user-1", source: "bearer", trustworthySubject: true } }; },
		},
		hostSilo: { resolveExactHost: async function _resolveHost() { return { siloId: "silo-1", authorizationScope: { kind: "organization", organizationId: "org-1" } }; } },
		membership: { verifyCurrentMembership: async function _membership() { return { outcome: "trusted", revision: 7, trustedUntilEpochMs: _NOW + 120_000 }; } },
		authorization: { authorize: async function _authorize() { return { outcome: "allowed", authorizationDigest: _AUTHORIZATION_DIGEST }; } },
		repository: {
			getConversationAuthority: async function _Conversation() { return { conversationId: "conversation-1", siloId: "silo-1", agentServiceId: "service-1", mode: "agent_session", lifecycle: "open", participantUserIds: ["user-1"] }; },
			issueInvocationContextAtomically: async function _issue() { return { status: "issued", context: { id: "context-1", routeId: "route-1", endpoint: "http://agent-runtime.silo-acme.svc.cluster.local:8080/v1/events" } }; },
			consumeInvocationContextAtomically: async function _consume() { return { status: "denied", reason: "not_found" }; },
		},
		clock: { nowEpochMs: function _now() { return _NOW; } },
		opaqueContext: { create: function _create() { return _OPAQUE_CONTEXT; } },
	};
}

/** Constructs the common workload-authenticated browser request. */
function _command()
{
	return { workloadToken: "projected-token", cookie: "session=opaque", delegatedAuthorization: "Bearer browser-token", trustedHost: "acme.example.com", action: "events.read", conversationId: "conversation-1" } as const;
}

describe("channel target resolution", () =>
{
	it("uses cookie identity first and persists only the opaque digest", async () =>
	{
		const dependencies = _dependencies();
		const bearer = vi.spyOn(dependencies.delegatedIdentity, "resolveBearer");
		let issued: IssueChannelInvocationContextCommand | undefined;
		dependencies.repository.issueInvocationContextAtomically = async function _issue(command)
		{
			issued = command;
			return { status: "issued", context: { id: "context-1", routeId: "route-1", endpoint: "http://agent-runtime.silo-acme.svc.cluster.local:8080/v1/events" } };
		};

		const result = await __ResolveChannelTarget(dependencies, _command());

		expect(result.outcome).toBe("authorized");
		expect(bearer).not.toHaveBeenCalled();
		expect(issued?.digest).toBe(`sha256:${createHash("sha256").update(_OPAQUE_CONTEXT).digest("hex")}`);
		expect(JSON.stringify(issued)).not.toContain(_OPAQUE_CONTEXT);
		expect(issued?.action).toBe("events.read");
	});

	it("does not fall back to bearer when a cookie is present but invalid", async () =>
	{
		const dependencies = _dependencies();
		dependencies.delegatedIdentity.resolveCookie = async function _cookieDenied() { return { outcome: "denied", reason: "invalid_cookie" }; };
		const bearer = vi.spyOn(dependencies.delegatedIdentity, "resolveBearer");

		const result = await __ResolveChannelTarget(dependencies, _command());

		expect(result).toEqual({ outcome: "denied", reason: "identity_denied" });
		expect(bearer).not.toHaveBeenCalled();
	});

	it("requires the exact TokenReview namespace, KSA, username, and audience", async () =>
	{
		const dependencies = _dependencies();
		dependencies.workloadIdentity.review = async function _wrongNamespace() { return { outcome: "trusted", identity: { username: "system:serviceaccount:other:channel-proxy", serviceAccountName: "channel-proxy", namespace: "other", audiences: ["opencrane"] } }; };

		const result = await __ResolveChannelTarget(dependencies, _command());

		expect(result).toEqual({ outcome: "denied", reason: "workload_denied" });
	});

	it("authorizes only conversation read before event-route issuance", async () =>
	{
		const dependencies = _dependencies();
		let requiredActions: readonly string[] = [];
		dependencies.authorization.authorize = async function _authorize(command)
		{
			requiredActions = command.requiredActions;
			return { outcome: "allowed", authorizationDigest: _AUTHORIZATION_DIGEST };
		};
		const result = await __ResolveChannelTarget(dependencies, _command());

		expect(requiredActions).toEqual(["conversation.read"]);
		expect(result.outcome).toBe("authorized");
	});

	it("fails closed when the conversation is outside the host silo or subject participation", async () =>
	{
		const dependencies = _dependencies();
		dependencies.repository.getConversationAuthority = async function _WrongConversation() { return { conversationId: "conversation-1", siloId: "silo-other", agentServiceId: "service-1", mode: "agent_session", lifecycle: "open", participantUserIds: [] }; };

		const result = await __ResolveChannelTarget(dependencies, _command());

		expect(result).toEqual({ outcome: "denied", reason: "conversation_denied" });
	});

	it("caps context expiry at the signed membership trust boundary", async () =>
	{
		const dependencies = _dependencies();
		dependencies.membership.verifyCurrentMembership = async function _membership() { return { outcome: "trusted", revision: 9, trustedUntilEpochMs: _NOW + 10_000 }; };
		let expiry = 0;
		dependencies.repository.issueInvocationContextAtomically = async function _issue(command)
		{
			expiry = command.expiresAtEpochMs;
			return { status: "issued", context: { id: "context-1", routeId: "route-1", endpoint: "http://agent-runtime.silo-acme.svc.cluster.local:8080/v1/events" } };
		};

		const result = await __ResolveChannelTarget(dependencies, _command());

		expect(result.outcome).toBe("authorized");
		expect(expiry).toBe(_NOW + 10_000);
	});
});
