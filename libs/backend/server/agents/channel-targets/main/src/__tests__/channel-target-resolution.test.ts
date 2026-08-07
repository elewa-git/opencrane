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
		runStart: { prepareInteractiveRun: async function _run() { return { outcome: "ready", runId: "run-1" }; } },
		repository: {
			getThreadAuthority: async function _thread() { return { threadId: "thread-1", siloId: "silo-1", agentServiceId: "service-1", state: "active", participantUserIds: ["user-1"] }; },
			issueInvocationContextAtomically: async function _issue() { return { status: "issued", context: { id: "context-1", routeId: "route-1", endpoint: "http://agent-runtime.silo-acme.svc.cluster.local:8080/v1/events" } }; },
			consumeInvocationContextAtomically: async function _consume() { return { status: "denied", reason: "not_found" }; },
		},
		clock: { nowEpochMs: function _now() { return _NOW; } },
		opaqueContext: { create: function _create() { return _OPAQUE_CONTEXT; } },
	};
}

/** Constructs the common workload-authenticated browser request. */
function _command(action: "command.forward" | "events.read" = "events.read")
{
	return { workloadToken: "projected-token", cookie: "session=opaque", delegatedAuthorization: "Bearer browser-token", trustedHost: "acme.example.com", action, threadId: "thread-1", requestIdempotencyKey: action === "command.forward" ? "delivery-1" : undefined } as const;
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
		expect(issued?.runId).toBeNull();
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

	it("requires both command actions and a real durable run before issuance", async () =>
	{
		const dependencies = _dependencies();
		let requiredActions: readonly string[] = [];
		dependencies.authorization.authorize = async function _authorize(command)
		{
			requiredActions = command.requiredActions;
			return { outcome: "allowed", authorizationDigest: _AUTHORIZATION_DIGEST };
		};
		dependencies.runStart.prepareInteractiveRun = async function _unavailable() { return { outcome: "unavailable", reason: "controller_not_composed" }; };
		const issue = vi.spyOn(dependencies.repository, "issueInvocationContextAtomically");

		const result = await __ResolveChannelTarget(dependencies, _command("command.forward"));

		expect(requiredActions).toEqual(["agent.run.start", "thread.message.create"]);
		expect(result).toEqual({ outcome: "denied", reason: "run_unavailable" });
		expect(issue).not.toHaveBeenCalled();
	});

	it("requires a transport idempotency key before a command may create a durable run", async function _RequiresCommandDeliveryKey()
	{
		const dependencies = _dependencies();
		const runStart = vi.spyOn(dependencies.runStart, "prepareInteractiveRun");

		const result = await __ResolveChannelTarget(dependencies, { ..._command("command.forward"), requestIdempotencyKey: undefined });

		expect(result).toEqual({ outcome: "denied", reason: "invalid_request" });
		expect(runStart).not.toHaveBeenCalled();
	});

	it("passes the accepted transport delivery key to the durable run-start authority", async function _BindsCommandDeliveryKey()
	{
		const dependencies = _dependencies();
		let prepared: unknown;
		dependencies.runStart.prepareInteractiveRun = async function _prepare(command)
		{
			prepared = command;
			return { outcome: "ready", runId: "run-1" };
		};

		const result = await __ResolveChannelTarget(dependencies, _command("command.forward"));

		expect(result.outcome).toBe("authorized");
		expect(prepared).toMatchObject({ threadId: "thread-1", requestIdempotencyKey: "delivery-1" });
	});

	it("fails closed when the thread is outside the host silo or subject participation", async () =>
	{
		const dependencies = _dependencies();
		dependencies.repository.getThreadAuthority = async function _wrongThread() { return { threadId: "thread-1", siloId: "silo-other", agentServiceId: "service-1", state: "active", participantUserIds: [] }; };

		const result = await __ResolveChannelTarget(dependencies, _command());

		expect(result).toEqual({ outcome: "denied", reason: "thread_denied" });
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
