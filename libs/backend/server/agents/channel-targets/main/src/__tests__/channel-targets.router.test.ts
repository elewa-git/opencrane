import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { __CreateChannelTargetsRouter } from "../channel-targets.router.js";
import type { ChannelTargetResolutionDependencies, PrepareInteractiveRunCommand } from "../channel-target-resolution.types.js";

/** Builds one router with trusted narrow ports and a caller-visible run-start capture seam. */
function _App(onPrepare: (command: PrepareInteractiveRunCommand) => void)
{
	const dependencies: ChannelTargetResolutionDependencies = {
		config: { workloadAudience: "opencrane", channelProxyServiceAccountName: "channel-proxy", channelProxyNamespace: "silo-a", invocationContextTtlMs: 60_000, allowedRouteHostSuffixes: [".svc.cluster.local"] },
		workloadIdentity: { review: async function _Review() { return { outcome: "trusted", identity: { username: "system:serviceaccount:silo-a:channel-proxy", serviceAccountName: "channel-proxy", namespace: "silo-a", audiences: ["opencrane"] } }; } },
		delegatedIdentity: { resolveCookie: async function _ResolveCookie() { return { outcome: "trusted", identity: { subjectId: "user-1", source: "cookie", trustworthySubject: true } }; }, resolveBearer: async function _ResolveBearer() { return { outcome: "denied", reason: "unexpected_bearer" }; } },
		hostSilo: { resolveExactHost: async function _ResolveExactHost() { return { siloId: "silo-1", authorizationScope: { kind: "organization", organizationId: "org-1" } }; } },
		membership: { verifyCurrentMembership: async function _VerifyCurrentMembership() { return { outcome: "trusted", revision: 1, trustedUntilEpochMs: 2_000_000 }; } },
		authorization: { authorize: async function _Authorize() { return { outcome: "allowed", authorizationDigest: `sha256:${"a".repeat(64)}` }; } },
		runStart: { prepareInteractiveRun: async function _PrepareInteractiveRun(command) { onPrepare(command); return { outcome: "ready", runId: "run-1" }; } },
		repository: {
			getThreadAuthority: async function _GetThreadAuthority() { return { threadId: "thread-1", siloId: "silo-1", agentServiceId: "service-1", state: "active", participantUserIds: ["user-1"] }; },
			issueInvocationContextAtomically: async function _IssueInvocationContext() { return { status: "issued", context: { id: "context-1", routeId: "route-1", endpoint: "http://agent-runtime.silo-a.svc.cluster.local:8080/v1/commands" } }; },
			consumeInvocationContextAtomically: async function _ConsumeInvocationContext() { return { status: "denied", reason: "not_found" }; },
		},
		clock: { nowEpochMs: function _NowEpochMs() { return 1_000_000; } },
		opaqueContext: { create: function _Create() { return "a".repeat(43); } },
	};
	const app = express();
	app.use(express.json());
	app.use(__CreateChannelTargetsRouter(dependencies));
	return app;
}

describe("channel-targets router", function _DescribeChannelTargetsRouter()
{
	it("forwards only a command's validated delivery key to durable run admission", async function _ForwardsDeliveryKey()
	{
		let prepared: PrepareInteractiveRunCommand | undefined;
		const app = _App(function _Capture(command) { prepared = command; });

		const response = await request(app).post("/").set("authorization", "Bearer proxy-token").set("cookie", "session=opaque").send({ action: "command.forward", trustedHost: "acme.example.com", threadId: "thread-1", requestIdempotencyKey: "delivery-1" });

		expect(response.status).toBe(200);
		expect(prepared).toMatchObject({ subjectId: "user-1", siloId: "silo-1", threadId: "thread-1", agentServiceId: "service-1", requestIdempotencyKey: "delivery-1" });
	});

	it("rejects a command without a transport idempotency key before run admission", async function _RejectsMissingDeliveryKey()
	{
		let prepares = 0;
		const app = _App(function _CountPrepare() { prepares += 1; });

		const response = await request(app).post("/").set("authorization", "Bearer proxy-token").set("cookie", "session=opaque").send({ action: "command.forward", trustedHost: "acme.example.com", threadId: "thread-1" });

		expect(response.status).toBe(403);
		expect(response.body).toEqual({ error: "invalid_request" });
		expect(prepares).toBe(0);
	});
});
