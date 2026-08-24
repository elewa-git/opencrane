import { describe, expect, it, vi } from "vitest";

import { DurableTaskRetryableError, DurableTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { DurableExecutionTransaction } from "@opencrane/backend/server/infra/workflows/contract";
import { __FakeDurableExecution } from "@opencrane/backend/server/infra/workflows/testing";

import type { IMcpOperatorRepository, McpEraProbeTargetRecord, McpOperatorServerRecord, McpOperatorTransaction, McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import { __CreateMcpEraProbeWorkflow, __McpEraProbeTaskKey } from "../era-probe/mcp-era-probe";
import { MCP_ERA_PROTOCOL_VERSION, McpEraProbeDecisions, McpEraProbeStates } from "../era-probe/mcp-era-probe.types";
import type { McpEraProbeClient, McpEraProbeTaskInput, McpEraProbeTaskResult } from "../era-probe/mcp-era-probe.types";
import { McpEraProbeFailure, McpEraProbeFailureCodes } from "../era-probe/mcp-era-probe-failure";

/** Mutable product state used by the engine-free workflow cases. */
interface _EraState
{
	target: McpEraProbeTargetRecord;
	auditCount: number;
}

/** Return stable task input without placing its identifiers in the task key. */
function _Input(): McpEraProbeTaskInput
{
	return { siloId: "silo-private", serverId: "server-private", registrationDigest: "sha256:registration" };
}

/** Build the complete server projection returned after a probe transition. */
function _Server(state: _EraState): McpOperatorServerRecord
{
	return {
		id: "server-private",
		name: "Remote server",
		description: "",
		publisher: null,
		glyph: null,
		serverType: "MultiUser",
		approvalStatus: state.target.eraProbeStatus === McpEraProbeStates.Accepted ? "PendingReview" : "Disabled",
		credentialSchema: [],
		entitlementSummary: null,
		endpoint: state.target.endpoint,
		registrationKeyDigest: "sha256:key",
		registrationDigest: state.target.registrationDigest,
		eraProbeStatus: state.target.eraProbeStatus,
		eraProtocolVersion: state.target.eraProtocolVersion,
		eraProbeEvidenceDigest: state.target.eraProbeEvidenceDigest,
		eraProbeFailureCode: state.target.eraProbeFailureCode,
		eraProbeAttempts: state.target.eraProbeAttempts,
	};
}

/** Provide only the transaction ports used by the era-probe task. */
function _UnitOfWork(state: _EraState): McpOperatorUnitOfWork
{
	const repository = {
		loadEraProbeTarget: vi.fn().mockImplementation(function _Load(): Promise<McpEraProbeTargetRecord> { return Promise.resolve({ ...state.target }); }),
		recordEraProbeResult: vi.fn().mockImplementation(function _Record(_siloId: string, _serverId: string, _registrationDigest: string, result: McpEraProbeTaskResult)
		{
			const changed = state.target.eraProbeStatus === McpEraProbeStates.Pending;
			if (changed)
			{
				state.target = { ...state.target, eraProbeStatus: result.decision === McpEraProbeDecisions.Accepted ? McpEraProbeStates.Accepted : McpEraProbeStates.Rejected, eraProtocolVersion: result.protocolVersion ?? null, eraProbeEvidenceDigest: result.evidenceDigest, eraProbeFailureCode: result.failureCode ?? null, eraProbeAttempts: state.target.eraProbeAttempts + 1 };
			}
			return Promise.resolve({ changed, server: _Server(state) });
		}),
		recordEraProbeRetry: vi.fn().mockImplementation(function _Retry(_siloId: string, _serverId: string, _registrationDigest: string, maximumAttempts: number, exhaustedResult: McpEraProbeTaskResult)
		{
			const changed = state.target.eraProbeStatus === McpEraProbeStates.Pending;
			if (changed)
			{
				const eraProbeAttempts = state.target.eraProbeAttempts + 1;
				state.target = eraProbeAttempts >= maximumAttempts
					? { ...state.target, eraProbeStatus: McpEraProbeStates.Rejected, eraProbeEvidenceDigest: exhaustedResult.evidenceDigest, eraProbeFailureCode: exhaustedResult.failureCode ?? null, eraProbeAttempts }
					: { ...state.target, eraProbeAttempts };
			}
			const exhausted = state.target.eraProbeStatus === McpEraProbeStates.Rejected && state.target.eraProbeFailureCode === exhaustedResult.failureCode;
			return Promise.resolve({ changed, exhausted, server: _Server(state) });
		}),
		appendAudit: vi.fn().mockImplementation(function _Audit(): Promise<void> { state.auditCount += 1; return Promise.resolve(); }),
	} as unknown as IMcpOperatorRepository;
	const transaction = { mcp: repository, durableExecution: _Transaction() } as unknown as McpOperatorTransaction;
	return { execute: async function _Execute<Result>(operation: (value: McpOperatorTransaction) => Promise<Result>): Promise<Result> { return await operation(transaction); } };
}

/** Return an opaque database transaction for fake task admission. */
function _Transaction(): DurableExecutionTransaction
{
	return { client: {} };
}

/** Start fake workers after admitting one task. */
async function _Drain(execution: __FakeDurableExecution): Promise<void>
{
	await execution.startWorkers({ workerName: "mcp-era-probe-test" });
}

/** Return one pending catalogue target. */
function _State(): _EraState
{
	return { target: { endpoint: "https://mcp.example.test/", registrationDigest: _Input().registrationDigest, eraProbeStatus: McpEraProbeStates.Pending, eraProtocolVersion: null, eraProbeEvidenceDigest: null, eraProbeFailureCode: null, eraProbeAttempts: 0 }, auditCount: 0 };
}

describe("MCP era-probe workflow", function _McpEraProbeSuite()
{
	it("accepts the required protocol revision and moves the draft to review", async function _AcceptsRequiredEra()
	{
		const state = _State();
		const execution = new __FakeDurableExecution();
		const probe = vi.fn().mockResolvedValue({ protocolVersion: MCP_ERA_PROTOCOL_VERSION, evidenceDigest: `sha256:${"a".repeat(64)}` });
		const workflow = __CreateMcpEraProbeWorkflow({ execution, unitOfWork: _UnitOfWork(state), probe: { probe } });
		const admitted = await workflow.admit(_Transaction(), _Input());

		await _Drain(execution);

		expect(execution.taskSnapshot(admitted.receipt).result).toEqual({ protocolVersion: MCP_ERA_PROTOCOL_VERSION, evidenceDigest: `sha256:${"a".repeat(64)}`, decision: McpEraProbeDecisions.Accepted });
		expect(state.target.eraProbeStatus).toBe("Accepted");
		expect(state.auditCount).toBe(1);
	});

	it("rejects another protocol revision", async function _RejectsOtherEra()
	{
		const state = _State();
		const execution = new __FakeDurableExecution();
		const probe: McpEraProbeClient = { probe: vi.fn().mockResolvedValue({ protocolVersion: "2025-11-25", evidenceDigest: `sha256:${"b".repeat(64)}` }) };
		const workflow = __CreateMcpEraProbeWorkflow({ execution, unitOfWork: _UnitOfWork(state), probe });
		const admitted = await workflow.admit(_Transaction(), _Input());

		await _Drain(execution);

		expect(execution.taskSnapshot(admitted.receipt).result).toMatchObject({ decision: McpEraProbeDecisions.Rejected });
		expect(state.target.eraProbeStatus).toBe("Rejected");
	});

	it("fails permanently when the remote evidence is malformed", async function _RejectsMalformedEvidence()
	{
		const execution = new __FakeDurableExecution();
		const probe = { probe: vi.fn().mockResolvedValue({ protocolVersion: MCP_ERA_PROTOCOL_VERSION, evidenceDigest: "raw-response" }) } as unknown as McpEraProbeClient;
		const workflow = __CreateMcpEraProbeWorkflow({ execution, unitOfWork: _UnitOfWork(_State()), probe });
		const admitted = await workflow.admit(_Transaction(), _Input());

		await _Drain(execution);

		expect(execution.taskSnapshot(admitted.receipt).error).toBeInstanceOf(DurableTaskTerminalError);
	});

	it("asks the engine to retry a temporary transport failure", async function _RetriesTemporaryFailure()
	{
		const state = _State();
		const execution = new __FakeDurableExecution();
		const probe = { probe: vi.fn().mockRejectedValue(new McpEraProbeFailure(McpEraProbeFailureCodes.RetryableUnavailable)) };
		const workflow = __CreateMcpEraProbeWorkflow({ execution, unitOfWork: _UnitOfWork(state), probe });
		const admitted = await workflow.admit(_Transaction(), _Input());

		await _Drain(execution);

		expect(execution.taskSnapshot(admitted.receipt).error).toBeInstanceOf(DurableTaskRetryableError);
		expect(state.target.eraProbeStatus).toBe("Pending");
		expect(state.target.eraProbeAttempts).toBe(1);
		expect(state.auditCount).toBe(0);
	});

	it("stores a final rejection when temporary failures consume all attempts", async function _ExhaustsTemporaryFailures()
	{
		const state = _State();
		state.target = { ...state.target, eraProbeAttempts: 4 };
		const execution = new __FakeDurableExecution();
		const probe = { probe: vi.fn().mockRejectedValue(new McpEraProbeFailure(McpEraProbeFailureCodes.RetryableUnavailable)) };
		const workflow = __CreateMcpEraProbeWorkflow({ execution, unitOfWork: _UnitOfWork(state), probe });
		const admitted = await workflow.admit(_Transaction(), _Input());

		await _Drain(execution);

		expect(execution.taskSnapshot(admitted.receipt).result).toMatchObject({ decision: McpEraProbeDecisions.Rejected, failureCode: McpEraProbeFailureCodes.RetryExhausted });
		expect(state.target).toMatchObject({ eraProbeStatus: "Rejected", eraProbeFailureCode: McpEraProbeFailureCodes.RetryExhausted, eraProbeAttempts: 5 });
		expect(state.auditCount).toBe(1);
	});

	it.each([McpEraProbeFailureCodes.UnsafeEndpoint, McpEraProbeFailureCodes.InvalidResponse])("stores terminal failure %s as a rejected result", async function _StoresTerminalFailure(code)
	{
		const state = _State();
		const execution = new __FakeDurableExecution();
		const probe = { probe: vi.fn().mockRejectedValue(new McpEraProbeFailure(code)) };
		const workflow = __CreateMcpEraProbeWorkflow({ execution, unitOfWork: _UnitOfWork(state), probe });
		const admitted = await workflow.admit(_Transaction(), _Input());

		await _Drain(execution);

		expect(execution.taskSnapshot(admitted.receipt).result).toMatchObject({ decision: McpEraProbeDecisions.Rejected, failureCode: code });
		expect(state.target).toMatchObject({ eraProbeStatus: "Rejected", eraProtocolVersion: null, eraProbeFailureCode: code });
		expect(state.auditCount).toBe(1);
	});

	it("returns stored evidence on replay without contacting the remote server", async function _ReplaysStoredResult()
	{
		const state = _State();
		state.target = { ...state.target, eraProbeStatus: McpEraProbeStates.Accepted, eraProtocolVersion: MCP_ERA_PROTOCOL_VERSION, eraProbeEvidenceDigest: `sha256:${"c".repeat(64)}`, eraProbeFailureCode: null };
		const execution = new __FakeDurableExecution();
		const probe = vi.fn();
		const workflow = __CreateMcpEraProbeWorkflow({ execution, unitOfWork: _UnitOfWork(state), probe: { probe } });
		const admitted = await workflow.admit(_Transaction(), _Input());

		await _Drain(execution);

		expect(probe).not.toHaveBeenCalled();
		expect(execution.taskSnapshot(admitted.receipt).result).toMatchObject({ decision: McpEraProbeDecisions.Accepted });
		expect(state.auditCount).toBe(0);
	});

	it("replays a stored terminal rejection without contacting the remote server", async function _ReplaysStoredFailure()
	{
		const state = _State();
		state.target = { ...state.target, eraProbeStatus: McpEraProbeStates.Rejected, eraProtocolVersion: null, eraProbeEvidenceDigest: `sha256:${"d".repeat(64)}`, eraProbeFailureCode: McpEraProbeFailureCodes.InvalidResponse };
		const execution = new __FakeDurableExecution();
		const probe = vi.fn();
		const workflow = __CreateMcpEraProbeWorkflow({ execution, unitOfWork: _UnitOfWork(state), probe: { probe } });
		const admitted = await workflow.admit(_Transaction(), _Input());

		await _Drain(execution);

		expect(probe).not.toHaveBeenCalled();
		expect(execution.taskSnapshot(admitted.receipt).result).toMatchObject({ decision: McpEraProbeDecisions.Rejected, failureCode: McpEraProbeFailureCodes.InvalidResponse });
		expect(state.auditCount).toBe(0);
	});

	it("uses one opaque task key for repeated admission", async function _DeduplicatesAdmission()
	{
		const execution = new __FakeDurableExecution();
		const workflow = __CreateMcpEraProbeWorkflow({ execution, unitOfWork: _UnitOfWork(_State()), probe: { probe: vi.fn() } });
		const first = await workflow.admit(_Transaction(), _Input());
		const second = await workflow.admit(_Transaction(), _Input());

		expect(first.receipt).toBe(second.receipt);
		expect(__McpEraProbeTaskKey(_Input())).toBe(first.taskKey);
		expect(first.taskKey).not.toContain(_Input().siloId);
		expect(first.taskKey).not.toContain(_Input().serverId);
		expect(first.taskKey).toMatch(/^workflows:mcp-era-probe:[a-f0-9]{64}$/u);
	});
});
