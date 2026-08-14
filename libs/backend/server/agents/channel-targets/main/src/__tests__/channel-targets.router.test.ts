import express from "express";
import request from "supertest";
import type { Logger } from "@opencrane/backend/observability";
import { describe, expect, it, vi } from "vitest";

import { __CreateChannelTargetsRouter } from "../channel-targets.router";
import type { ChannelTargetResolutionDependencies } from "../channel-target-resolution.types";

/** Builds one event-only resolver with trusted narrow ports. */
function _App(overrides: { readonly failAuthority?: boolean; readonly log?: Logger } = {})
{
	const dependencies: ChannelTargetResolutionDependencies = {
		config: { workloadAudience: "opencrane", channelProxyServiceAccountName: "channel-proxy", channelProxyNamespace: "silo-a", invocationContextTtlMs: 60_000, allowedRouteHostSuffixes: [".svc.cluster.local"], receiverId: "conversation-replay-v1", receiverEndpoint: "http://agent-runtime.silo-a.svc.cluster.local:8080/v1/commands" },
		workloadIdentity: { __Review: async function _Review() { if (overrides.failAuthority) throw new Error("token review unavailable"); return { username: "system:serviceaccount:silo-a:channel-proxy", serviceAccountName: "channel-proxy", namespace: "silo-a", audiences: ["opencrane"] }; } },
		hostSilo: { resolveExactHost: async function _ResolveExactHost() { return { siloId: "silo-1", authorizationScope: { kind: "organization", organizationId: "silo-1" } }; } },
		membership: { verifyCurrentMembership: async function _VerifyCurrentMembership() { return { outcome: "trusted", revision: 1, trustedUntilEpochMs: 2_000_000 }; } },
		repository: {
			getConversationAuthority: async function _GetConversationAuthority() { return { conversationId: "conversation-1", siloId: "silo-1", agentServiceId: "service-1", mode: "agent_session", lifecycle: "open", participantUserIds: ["user-1"] }; },
			reconcileRuntimeRoutes: async function _ReconcileRuntimeRoutes() { return 0; },
			issueInvocationContextAtomically: async function _IssueInvocationContext() { return { status: "issued", context: { id: "context-1", routeId: "route-1", receiverId: "conversation-replay-v1", endpoint: "http://agent-runtime.silo-a.svc.cluster.local:8080/v1/events" } }; },
			consumeInvocationContextAtomically: async function _ConsumeInvocationContext() { return { status: "denied", reason: "not_found" }; },
		},
		clock: { nowEpochMs: function _NowEpochMs() { return 1_000_000; } },
		opaqueContext: { create: function _Create() { return "a".repeat(43); } },
	};
	const app = express();
	app.use(express.json());
	app.use(function _VerifiedSession(request, _response, next)
	{
		request.session = { authUser: { sub: "user-1" } } as never;
		next();
	});
	const log = overrides.log ?? { error: vi.fn() } as unknown as Logger;
	app.use(__CreateChannelTargetsRouter(dependencies, log));
	return app;
}

describe("channel-targets router", function _DescribeChannelTargetsRouter()
{
	it("resolves an authorized conversation event route", async function _ResolvesEventRoute()
	{
		const response = await request(_App()).post("/").set("authorization", "Bearer proxy-token").set("cookie", "session=opaque").send({ action: "events.read", trustedHost: "acme.example.com", conversationId: "conversation-1" });

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ subjectId: "user-1", endpoint: "http://agent-runtime.silo-a.svc.cluster.local:8080/v1/events" });
	});

	it("rejects the removed command-forwarding protocol", async function _RejectsRemovedCommand()
	{
		const response = await request(_App()).post("/").set("authorization", "Bearer proxy-token").set("cookie", "session=opaque").send({ action: "command.forward", trustedHost: "acme.example.com", conversationId: "conversation-1", requestIdempotencyKey: "delivery-1" });

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "invalid_request" });
	});

	it("logs structured safe coordinates when an authority is unavailable", async function _LogsAuthorityFailure()
	{
		const error = vi.fn();
		const response = await request(_App({ failAuthority: true, log: { error } as unknown as Logger })).post("/").set("authorization", "Bearer proxy-token").set("cookie", "session=opaque").send({ action: "events.read", trustedHost: "acme.example.com", conversationId: "conversation-1" });

		expect(response.status).toBe(503);
		expect(error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error), action: "events.read", conversationId: "conversation-1" }), "channel target authority failed");
		expect(JSON.stringify(error.mock.calls)).not.toContain("proxy-token");
	});
});
