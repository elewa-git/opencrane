import { describe, expect, it, vi } from "vitest";

import { __CreateHttpWarmAgentRunWorkflowControllerAuthority } from "../http-agent-run-workflow-controller-authority";
import type { AgentRunWorkflowControllerFetch } from "../agent-run-workflow-http-authority.types";

/** Creates a controller authority whose requests are answered by one local fetch double. */
function _Authority(fetch: AgentRunWorkflowControllerFetch)
{
	return __CreateHttpWarmAgentRunWorkflowControllerAuthority({ openCraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001", serverServiceName: "opencrane-server", serverNamespace: "silo-a", tokenPath: "/token", requestTimeoutMilliseconds: 5_000, fetch, readToken: async function _ReadToken() { return "rotated-token"; } });
}

/** Returns the one task identity saved with the durable AgentRun admission. */
function _Task()
{
	return { taskId: "task-1", taskName: "agent-runs.execute/v1" as const, idempotencyKey: "agent-run:silo-a:run-1:attempt:1" };
}

describe("warm AgentRun workflow controller HTTP authority", function _Suite()
{
	it("sends the saved task request and validates the returned server record", async function _LoadsRecord()
	{
		const fetch = vi.fn(async function _Fetch(input: string | URL | Request, init?: RequestInit)
		{
			expect(String(input)).toBe("http://opencrane-server.silo-a.svc.cluster.local:3001/api/internal/agent-controller/agent-run-workflows/load");
			expect(init?.headers).toEqual(expect.objectContaining({}));
			return new Response(JSON.stringify({ siloId: "silo-a", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", workloadProfile: "personal-default", namespace: "silo-a-runtime", bootstrapReference: "bootstrap-v1_test", assignmentExpiresAt: "2099-01-01T00:00:00.000Z" }), { status: 200 });
		});
		const authority = _Authority(fetch);

		await expect(authority.loadForTask({ siloId: "silo-a", runId: "run-1", attempt: 1 }, _Task())).resolves.toMatchObject({ runId: "run-1", namespace: "silo-a-runtime" });
		expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ input: { siloId: "silo-a", runId: "run-1", attempt: 1 }, task: _Task() }));
	});

	it("maps a stale server response to the handler stop outcome", async function _MapsStale()
	{
		const authority = _Authority(vi.fn(async function _Fetch() { return new Response(JSON.stringify({ error: "stale" }), { status: 409 }); }));

		await expect(authority.loadForTask({ siloId: "silo-a", runId: "run-1", attempt: 1 }, _Task())).resolves.toBeNull();
	});

	it("reports a terminal task failure with its exact saved receipt", async function _ReportsTerminalFailure()
	{
		const fetch = vi.fn(async function _Fetch(input: string | URL | Request, _init?: RequestInit)
		{
			expect(String(input)).toBe("http://opencrane-server.silo-a.svc.cluster.local:3001/api/internal/agent-controller/agent-run-workflows/terminal-failure");
			return new Response(null, { status: 204 });
		});
		const authority = _Authority(fetch);

		await expect(authority.terminalizeFailedTask({ siloId: "silo-a", runId: "run-1", attempt: 1 }, _Task())).resolves.toBeUndefined();
		expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ input: { siloId: "silo-a", runId: "run-1", attempt: 1 }, task: _Task() }));
	});
});
