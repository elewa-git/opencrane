import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { __CreateMcpCompanionRemote, __CreateMcpCompanionServer, __ParseMcpCompanionClaimRequest, __ParseMcpCompanionClaimResponse, __ParseMcpCompanionCompletionRequest, __ParseMcpCompanionFailureRequest, __ReadMcpCompanionIdentity, __RunMcpCompanion, McpCompanionCommandKinds, McpCompanionFailureCodes, McpCompanionRemoteClaimOutcomes, McpCompanionRunOutcomes } from "../index";
import type { McpCompanionCommand, McpCompanionDependencies, McpCompanionFetch, McpCompanionIdentity } from "../index";

/** Current test lease returned by server authority. */
const _LEASE = { executionId: "execution-1", claimFence: "fence-1", expiresAt: "2999-01-01T00:00:00.000Z" } as const;
/** Exact projected identity sent only to OpenCrane. */
const _IDENTITY: McpCompanionIdentity = { executionReference: "opaque-reference", podUid: "pod-uid" };

/** Return a JSON response with an exact content-length header. */
function _Json(value: unknown): Response
{
	const body = JSON.stringify(value);
	return new Response(body, { status: 200, headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } });
}

/** Return the smallest logger surface used by companion orchestration. */
function _Logger()
{
	return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn() } as never;
}

describe("MCP companion wire", function _DescribeWire()
{
	it("shares strict claim and terminal validators with the server route", function _ValidatesWire()
	{
		expect(__ParseMcpCompanionClaimRequest(_IDENTITY)).toEqual(_IDENTITY);
		expect(__ParseMcpCompanionClaimResponse({ kind: McpCompanionCommandKinds.Discovery, ..._LEASE }, new Date("2026-01-01T00:00:00.000Z"))).toEqual({ kind: McpCompanionCommandKinds.Discovery, ..._LEASE });
		expect(__ParseMcpCompanionCompletionRequest({ ..._IDENTITY, executionId: _LEASE.executionId, claimFence: _LEASE.claimFence, completion: { kind: McpCompanionCommandKinds.Discovery, tools: [] } })).toMatchObject({ completion: { kind: McpCompanionCommandKinds.Discovery } });
		expect(__ParseMcpCompanionFailureRequest({ ..._IDENTITY, executionId: _LEASE.executionId, claimFence: _LEASE.claimFence, failureCode: McpCompanionFailureCodes.DiscoveryFailed })).toMatchObject({ failureCode: McpCompanionFailureCodes.DiscoveryFailed });
	});

	it("rejects extra identity fields, stale leases, and invented failure codes", function _RejectsInvalidWire()
	{
		expect(function _ExtraIdentity() { __ParseMcpCompanionClaimRequest({ ..._IDENTITY, token: "secret" }); }).toThrow(/invalid shape/u);
		expect(function _Expired() { __ParseMcpCompanionClaimResponse({ kind: McpCompanionCommandKinds.Discovery, ..._LEASE, expiresAt: "2020-01-01T00:00:00.000Z" }, new Date("2026-01-01T00:00:00.000Z")); }).toThrow(/expired/u);
		expect(function _InventedFailure() { __ParseMcpCompanionFailureRequest({ ..._IDENTITY, executionId: _LEASE.executionId, claimFence: _LEASE.claimFence, failureCode: "remote_error_text" }); }).toThrow(/invalid shape/u);
	});
});

describe("MCP companion projected identity", function _DescribeIdentity()
{
	it("rejects a blank mounted reference and malformed Pod UID", async function _RejectsInvalidIdentity()
	{
		const directory = await mkdtemp(join(tmpdir(), "mcp-companion-test-"));
		const referencePath = join(directory, "reference");
		try
		{
			await writeFile(referencePath, "   ", "utf8");
			await expect(__ReadMcpCompanionIdentity(referencePath, "pod-uid")).rejects.toThrow(/reference/u);
			await writeFile(referencePath, "reference", "utf8");
			await expect(__ReadMcpCompanionIdentity(referencePath, "pod\nuid")).rejects.toThrow(/Pod UID/u);
		}
		finally
		{
			await rm(directory, { recursive: true, force: true });
		}
	});
});

describe("MCP companion OpenCrane adapter", function _DescribeRemote()
{
	it("rereads the projected token and uses only the three fixed routes", async function _RotatesToken()
	{
		const requests: { readonly url: string; readonly init: RequestInit }[] = [];
		const fetcher: McpCompanionFetch = vi.fn(async function _Fetch(input, init)
		{
			requests.push({ url: String(input), init: init ?? {} });
			if (requests.length === 1)
				return _Json({ kind: McpCompanionCommandKinds.Discovery, ..._LEASE });
			return new Response(null, { status: 204 });
		});
		const readToken = vi.fn().mockResolvedValueOnce("token-one").mockResolvedValueOnce("token-two").mockResolvedValueOnce("token-three");
		const remote = __CreateMcpCompanionRemote({ openCraneExecutorUrl: "http://opencrane-server.default.svc.cluster.local:8081/api/internal/mcp-executor", tokenPath: "/tokens/token", requestTimeoutMilliseconds: 1_000, maximumResponseBytes: 1_024, maximumRequestBytes: 4_096, fetch: fetcher, readToken });
		const command = await remote.claim(_IDENTITY, new AbortController().signal);
		if (command === null || command === McpCompanionRemoteClaimOutcomes.Terminal)
			throw new Error("test expected a discovery command");
		await remote.complete(_IDENTITY, command.lease, { kind: McpCompanionCommandKinds.Discovery, tools: [] }, new AbortController().signal);
		await remote.fail(_IDENTITY, command.lease, McpCompanionFailureCodes.DiscoveryFailed, new AbortController().signal);
		expect(requests.map(function _Url(request) { return request.url; })).toEqual([
			"http://opencrane-server.default.svc.cluster.local:8081/api/internal/mcp-executor/claim",
			"http://opencrane-server.default.svc.cluster.local:8081/api/internal/mcp-executor/complete",
			"http://opencrane-server.default.svc.cluster.local:8081/api/internal/mcp-executor/fail",
		]);
		expect((requests[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer token-one");
		expect((requests[1]!.init.headers as Record<string, string>).authorization).toBe("Bearer token-two");
		expect((requests[2]!.init.headers as Record<string, string>).authorization).toBe("Bearer token-three");
		expect(requests.every(function _NoRedirect(request) { return request.init.redirect === "error"; })).toBe(true);
		expect(JSON.parse(String(requests[0]!.init.body))).toEqual(_IDENTITY);
	});

	it("rejects an oversized claim before JSON parsing", async function _RejectsOversizedClaim()
	{
		const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: { "content-length": "1025" } }));
		const remote = __CreateMcpCompanionRemote({ openCraneExecutorUrl: "http://opencrane-server.default.svc.cluster.local:8081/api/internal/mcp-executor", tokenPath: "/tokens/token", requestTimeoutMilliseconds: 1_000, maximumResponseBytes: 1_024, maximumRequestBytes: 4_096, fetch: fetcher, readToken: vi.fn().mockResolvedValue("token") });
		await expect(remote.claim(_IDENTITY, new AbortController().signal)).rejects.toThrow(/byte limit/u);
	});

	it("maps a finished saved execution to a stop decision", async function _StopsAfterTerminalResponse()
	{
		const remote = __CreateMcpCompanionRemote({ openCraneExecutorUrl: "http://opencrane-server.default.svc.cluster.local:8081/api/internal/mcp-executor", tokenPath: "/tokens/token", requestTimeoutMilliseconds: 1_000, maximumResponseBytes: 1_024, maximumRequestBytes: 4_096, fetch: vi.fn().mockResolvedValue(new Response(null, { status: 410 })), readToken: vi.fn().mockResolvedValue("token") });
		await expect(remote.claim(_IDENTITY, new AbortController().signal)).resolves.toBe(McpCompanionRemoteClaimOutcomes.Terminal);
	});

	it("applies the configured timeout to a stalled claim", async function _TimesOutClaim()
	{
		const fetcher: McpCompanionFetch = vi.fn(function _Fetch(_input, init)
		{
			return new Promise<Response>(function _Wait(_resolve, reject)
			{
				init?.signal?.addEventListener("abort", function _Abort() { reject(init.signal?.reason); }, { once: true });
			});
		});
		const remote = __CreateMcpCompanionRemote({ openCraneExecutorUrl: "http://opencrane-server.default.svc.cluster.local:8081/api/internal/mcp-executor", tokenPath: "/tokens/token", requestTimeoutMilliseconds: 5, maximumResponseBytes: 1_024, maximumRequestBytes: 4_096, fetch: fetcher, readToken: vi.fn().mockResolvedValue("token") });
		await expect(remote.claim(_IDENTITY, new AbortController().signal)).rejects.toBeInstanceOf(Error);
	});
});

describe("MCP companion Pod-local adapter", function _DescribeServer()
{
	it("discovers before listing and before exactly one admitted invocation", async function _SequencesProtocol()
	{
		const methods: string[] = [];
		const fetcher: McpCompanionFetch = vi.fn(async function _Fetch(_input, init)
		{
			const request = JSON.parse(String(init?.body)) as { readonly id: string; readonly method: string };
			methods.push(request.method);
			if (request.method === "server/discover")
				return _Json({ jsonrpc: "2.0", id: request.id, result: { resultType: "complete", supportedVersions: ["2026-07-28"] } });
			if (request.method === "tools/list")
				return _Json({ jsonrpc: "2.0", id: request.id, result: { tools: [] } });
			return _Json({ jsonrpc: "2.0", id: request.id, result: { isError: false, content: [{ type: "text", text: "done" }] } });
		});
		const server = __CreateMcpCompanionServer({ serverUrl: "http://127.0.0.1:3000/mcp", requestTimeoutMilliseconds: 1_000, maximumRequestBytes: 4_096, maximumResponseBytes: 4_096, fetch: fetcher });
		await expect(server.discover(new AbortController().signal)).resolves.toEqual([]);
		const command = { kind: McpCompanionCommandKinds.Invocation, lease: _LEASE, invocationId: "invocation-1", toolName: "calendar.read", arguments: { day: "today" } } as const;
		await expect(server.call(command, new AbortController().signal)).resolves.toMatchObject({ isError: false });
		expect(methods).toEqual(["server/discover", "tools/list", "server/discover", "tools/call"]);
		expect(methods.filter(function _Calls(method) { return method === "tools/call"; })).toHaveLength(1);
	});

	it("refuses the tool side effect when discovery consumes the lease", async function _FencesToolCall()
	{
		const methods: string[] = [];
		const fetcher: McpCompanionFetch = vi.fn(async function _Fetch(_input, init)
		{
			const request = JSON.parse(String(init?.body)) as { readonly id: string; readonly method: string };
			methods.push(request.method);
			await new Promise<void>(function _Delay(resolve) { setTimeout(resolve, 15); });
			return _Json({ jsonrpc: "2.0", id: request.id, result: { resultType: "complete", supportedVersions: ["2026-07-28"] } });
		});
		const server = __CreateMcpCompanionServer({ serverUrl: "http://127.0.0.1:3000/mcp", requestTimeoutMilliseconds: 1_000, maximumRequestBytes: 4_096, maximumResponseBytes: 4_096, fetch: fetcher });
		const command = { kind: McpCompanionCommandKinds.Invocation, lease: { ..._LEASE, expiresAt: new Date(Date.now() + 5).toISOString() }, invocationId: "invocation-1", toolName: "calendar.read", arguments: {} } as const;
		await expect(server.call(command, new AbortController().signal)).rejects.toThrow(/expired/u);
		expect(methods).toEqual(["server/discover"]);
	});
});

describe("MCP companion orchestration", function _DescribeOrchestration()
{
	it("exits when OpenCrane closed the saved execution before dispatch", async function _StopsWithoutPolling()
	{
		const claim = vi.fn().mockResolvedValue(McpCompanionRemoteClaimOutcomes.Terminal);
		const dependencies: McpCompanionDependencies = { remote: { claim, complete: vi.fn(), fail: vi.fn() }, server: { ready: vi.fn().mockResolvedValue(undefined), discover: vi.fn(), call: vi.fn() }, log: _Logger() };
		await expect(__RunMcpCompanion(dependencies, _IDENTITY, new AbortController().signal)).resolves.toBe(McpCompanionRunOutcomes.Stopped);
		expect(claim).toHaveBeenCalledOnce();
	});

	it("waits for controller Pod registration before taking its one command", async function _WaitsForRegistration()
	{
		const command: McpCompanionCommand = { kind: McpCompanionCommandKinds.Discovery, lease: _LEASE };
		const claim = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(command);
		const dependencies: McpCompanionDependencies = { remote: { claim, complete: vi.fn().mockResolvedValue(undefined), fail: vi.fn() }, server: { ready: vi.fn().mockResolvedValue(undefined), discover: vi.fn().mockResolvedValue([]), call: vi.fn() }, log: _Logger() };
		await expect(__RunMcpCompanion(dependencies, _IDENTITY, new AbortController().signal)).resolves.toBe(McpCompanionRunOutcomes.Completed);
		expect(claim).toHaveBeenCalledTimes(2);
	});

	it("refuses discovery after its database command lease expires", async function _BoundsDiscovery()
	{
		const command: McpCompanionCommand = { kind: McpCompanionCommandKinds.Discovery, lease: { ..._LEASE, expiresAt: new Date(Date.now() - 1).toISOString() } };
		const discover = vi.fn();
		const fail = vi.fn().mockResolvedValue(undefined);
		const dependencies: McpCompanionDependencies = { remote: { claim: vi.fn().mockResolvedValue(command), complete: vi.fn(), fail }, server: { ready: vi.fn().mockResolvedValue(undefined), discover, call: vi.fn() }, log: _Logger() };
		await expect(__RunMcpCompanion(dependencies, _IDENTITY, new AbortController().signal)).resolves.toBe(McpCompanionRunOutcomes.Failed);
		expect(fail).toHaveBeenCalledWith(_IDENTITY, command.lease, McpCompanionFailureCodes.DiscoveryFailed, expect.any(AbortSignal));
		expect(discover).not.toHaveBeenCalled();
	});

	it("does not repeat a tool call or report failure after ambiguous completion", async function _PreservesAmbiguity()
	{
		const command: McpCompanionCommand = { kind: McpCompanionCommandKinds.Invocation, lease: _LEASE, invocationId: "invocation-1", toolName: "calendar.read", arguments: { secret: "never-log" } };
		const call = vi.fn().mockResolvedValue({ isError: false, content: [] });
		const complete = vi.fn().mockRejectedValue(new Error("completion response lost"));
		const fail = vi.fn();
		const dependencies: McpCompanionDependencies = { remote: { claim: vi.fn().mockResolvedValue(command), complete, fail }, server: { ready: vi.fn().mockResolvedValue(undefined), discover: vi.fn(), call }, log: _Logger() };
		await expect(__RunMcpCompanion(dependencies, _IDENTITY, new AbortController().signal)).rejects.toThrow(/response lost/u);
		expect(call).toHaveBeenCalledOnce();
		expect(complete).toHaveBeenCalledOnce();
		expect(fail).not.toHaveBeenCalled();
	});

	it("reports one stable code and logs no arguments or remote error text", async function _ReportsSafeFailure()
	{
		const command: McpCompanionCommand = { kind: McpCompanionCommandKinds.Invocation, lease: _LEASE, invocationId: "invocation-1", toolName: "calendar.read", arguments: { secret: "never-log" } };
		const logger = _Logger() as unknown as { readonly warn: ReturnType<typeof vi.fn> };
		const fail = vi.fn().mockResolvedValue(undefined);
		const dependencies: McpCompanionDependencies = { remote: { claim: vi.fn().mockResolvedValue(command), complete: vi.fn(), fail }, server: { ready: vi.fn().mockResolvedValue(undefined), discover: vi.fn(), call: vi.fn().mockRejectedValue(new Error("provider said SECRET_VALUE")) }, log: logger as never };
		await expect(__RunMcpCompanion(dependencies, _IDENTITY, new AbortController().signal)).resolves.toBe(McpCompanionRunOutcomes.Failed);
		expect(fail).toHaveBeenCalledWith(_IDENTITY, _LEASE, McpCompanionFailureCodes.ToolCallFailed, expect.any(AbortSignal));
		expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("never-log");
		expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("SECRET_VALUE");
	});
});
