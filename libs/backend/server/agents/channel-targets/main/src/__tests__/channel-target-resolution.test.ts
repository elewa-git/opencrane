import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ChannelTargetResolutionDependencies, IssueChannelInvocationContextCommand } from "../channel-target-resolution.types.js";
import { __ResolveChannelTarget } from "../channel-target-resolution.js";

/** Stable test instant. */
const _NOW = Date.parse("2026-07-18T12:00:00.000Z");
/** Opaque 256-bit-like test context. */
const _OPAQUE_CONTEXT = "a".repeat(43);

/** Builds fully trusted dependencies with focused override seams. */
function _dependencies(): ChannelTargetResolutionDependencies
{
	return {
		config: { workloadAudience: "opencrane", channelProxyServiceAccountName: "channel-proxy", channelProxyNamespace: "silo-acme", invocationContextTtlMs: 60_000, allowedRouteHostSuffixes: [".svc.cluster.local"], receiverId: "conversation-replay-v1", receiverEndpoint: "http://agent-runtime.silo-acme.svc.cluster.local:8080/v1/events" },
		workloadIdentity: { __Review: async function _review() { return { username: "system:serviceaccount:silo-acme:channel-proxy", serviceAccountName: "channel-proxy", namespace: "silo-acme", audiences: ["opencrane"] }; } },
		hostSilo: { resolveExactHost: async function _resolveHost() { return { siloId: "silo-1", authorizationScope: { kind: "organization", organizationId: "silo-1" } }; } },
		membership: { verifyCurrentMembership: async function _membership() { return { outcome: "trusted", revision: 7, trustedUntilEpochMs: _NOW + 120_000 }; } },
		repository: {
			getConversationAuthority: async function _Conversation() { return { conversationId: "conversation-1", siloId: "silo-1", agentServiceId: "service-1", mode: "agent_session", lifecycle: "open", participantUserIds: ["user-1"] }; },
			reconcileRuntimeRoutes: async function _Reconcile() { return 0; },
			issueInvocationContextAtomically: async function _issue() { return { status: "issued", context: { id: "context-1", routeId: "route-1", receiverId: "conversation-replay-v1", endpoint: "http://agent-runtime.silo-acme.svc.cluster.local:8080/v1/events" } }; },
			consumeInvocationContextAtomically: async function _consume() { return { status: "denied", reason: "not_found" }; },
		},
		clock: { nowEpochMs: function _now() { return _NOW; } },
		opaqueContext: { create: function _create() { return _OPAQUE_CONTEXT; } },
	};
}

/** Constructs the common workload-authenticated browser request. */
function _command()
{
	return { workloadToken: "projected-token", delegatedIdentity: { subjectId: "user-1", source: "cookie", trustworthySubject: true }, trustedHost: "acme.example.com", action: "events.read", conversationId: "conversation-1" } as const;
}

describe("channel target resolution", function _DescribeChannelTargetResolution()
{
	it("uses the session-verified identity and persists only the opaque digest", async function _PersistsOpaqueDigest()
	{
		const dependencies = _dependencies();
		let issued: IssueChannelInvocationContextCommand | undefined;
		dependencies.repository.issueInvocationContextAtomically = async function _issue(command)
		{
			issued = command;
			return { status: "issued", context: { id: "context-1", routeId: "route-1", receiverId: "conversation-replay-v1", endpoint: "http://agent-runtime.silo-acme.svc.cluster.local:8080/v1/events" } };
		};

		const result = await __ResolveChannelTarget(dependencies, _command());

		expect(result.outcome).toBe("authorized");
		expect(issued?.digest).toBe(`sha256:${createHash("sha256").update(_OPAQUE_CONTEXT).digest("hex")}`);
		expect(JSON.stringify(issued)).not.toContain(_OPAQUE_CONTEXT);
		expect(issued?.action).toBe("events.read");
		expect(issued?.receiverId).toBe("conversation-replay-v1");
		expect(issued?.authorizationDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
	});

	it("rejects an identity that was not verified by cookie session middleware", async function _RejectsUnverifiedIdentity()
	{
		const dependencies = _dependencies();
		const result = await __ResolveChannelTarget(dependencies, { ..._command(), delegatedIdentity: { subjectId: "", source: "cookie", trustworthySubject: true } });

		expect(result).toEqual({ outcome: "denied", reason: "identity_denied" });
	});

	it("requires the exact TokenReview namespace, KSA, username, and audience", async function _RejectsWrongWorkload()
	{
		const dependencies = _dependencies();
		dependencies.workloadIdentity.__Review = async function _wrongNamespace() { return { username: "system:serviceaccount:other:channel-proxy", serviceAccountName: "channel-proxy", namespace: "other", audiences: ["opencrane"] }; };

		const result = await __ResolveChannelTarget(dependencies, _command());

		expect(result).toEqual({ outcome: "denied", reason: "workload_denied" });
	});

	it("fails closed when the participant is absent", async function _RejectsMissingParticipant()
	{
		const dependencies = _dependencies();
		dependencies.repository.getConversationAuthority = async function _NoParticipant() { return { conversationId: "conversation-1", siloId: "silo-1", agentServiceId: "service-1", mode: "agent_session", lifecycle: "open", participantUserIds: [] }; };
		const result = await __ResolveChannelTarget(dependencies, _command());

		expect(result).toEqual({ outcome: "denied", reason: "authorization_denied" });
	});

	it("fails closed when the conversation is outside the host silo", async function _RejectsWrongSilo()
	{
		const dependencies = _dependencies();
		dependencies.repository.getConversationAuthority = async function _WrongConversation() { return { conversationId: "conversation-1", siloId: "silo-other", agentServiceId: "service-1", mode: "agent_session", lifecycle: "open", participantUserIds: [] }; };

		const result = await __ResolveChannelTarget(dependencies, _command());

		expect(result).toEqual({ outcome: "denied", reason: "conversation_denied" });
	});

	it("caps context expiry at the signed membership trust boundary", async function _CapsExpiry()
	{
		const dependencies = _dependencies();
		dependencies.membership.verifyCurrentMembership = async function _membership() { return { outcome: "trusted", revision: 9, trustedUntilEpochMs: _NOW + 10_000 }; };
		let expiry = 0;
		dependencies.repository.issueInvocationContextAtomically = async function _issue(command)
		{
			expiry = command.expiresAtEpochMs;
			return { status: "issued", context: { id: "context-1", routeId: "route-1", receiverId: "conversation-replay-v1", endpoint: "http://agent-runtime.silo-acme.svc.cluster.local:8080/v1/events" } };
		};

		const result = await __ResolveChannelTarget(dependencies, _command());

		expect(result.outcome).toBe("authorized");
		expect(expiry).toBe(_NOW + 10_000);
	});
});
