import { UPGRADE_SESSION_TOOL, UPGRADE_SESSION_TOOL_REVISION } from "@opencrane/backend/agents/personal/configuration";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { ToolInvocationIntent, ToolInvocationReceipt, ToolInvocationRepository, ToolInvocationReservationResult, ToolInvocationSuccessResult } from "@opencrane/backend/server/iam/authorization";
import type { CompiledToolDefinition, RunInputSnapshot, RuntimeExternalActionCandidate } from "@opencrane/contracts";
import type { Logger } from "@opencrane/backend/observability";
import { __UnavailableMemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";
import { __UnavailableObotMcpInvocationAdapter } from "@opencrane/backend/server/infra/obot-custody";
import { __UnavailableSandboxJobExecutor } from "@opencrane/backend/server/infra/sandbox-execution";
import type { JsonValue } from "@opencrane/util";
import { describe, expect, it, vi } from "vitest";

import { _CreateProductionExternalActionRunnerWithDependencies } from "../production-external-action-runner.js";
import type { ProductionExternalActionRunnerDependencies } from "../production-external-action-runner.types.js";

/** Fixed server instant proving proposal and approval time never comes from the runtime. */
const NOW = new Date("2026-08-01T08:00:00.000Z");

/** In-memory invocation ledger sufficient to prove reserve-before-I/O runner sequencing. */
class _InvocationRepository implements ToolInvocationRepository
{
	/** Intents observed in reservation order. */
	readonly intents: ToolInvocationIntent[] = [];
	/** Optional ordered-effect recorder used to prove reserve-before-approval sequencing. */
	private readonly effects?: string[];
	/** Most recently reserved intent used to produce a correctly bound receipt. */
	private intent: ToolInvocationIntent | null = null;

	/** Creates an in-memory ledger with an optional ordered-effect recorder. */
	constructor(effects?: string[])
	{
		this.effects = effects;
	}

	/** Records one fresh reservation for the candidate. */
	async reserve<TResult>(intent: ToolInvocationIntent): Promise<ToolInvocationReservationResult<TResult>>
	{
		this.effects?.push("reserve");
		this.intents.push(intent);
		this.intent = intent;
		return { status: "reserved", reservationId: "reservation-1" };
	}

	/** Completes the current reservation with a receipt bound to its exact fingerprint. */
	async markSucceeded<TResult>(_reservationId: string, result: TResult): Promise<ToolInvocationSuccessResult<TResult>>
	{
		if (this.intent === null) return { status: "conflict" };
		const receipt: ToolInvocationReceipt<TResult> = { toolInvocationId: this.intent.toolInvocationId, requestFingerprint: this.intent.requestFingerprint, result };
		return { status: "succeeded", receipt };
	}

	/** Records no failure in successful runner tests. */
	async markFailed(_reservationId: string, _failureCode: string): Promise<{ status: "failed" }>
	{
		return { status: "failed" };
	}

	/** Completes the current reservation by coordinates, reusing the id-based completion path. */
	async markSucceededByCoordinates<TResult>(_coordinates: { readonly runId: string; readonly attempt: number; readonly toolInvocationId: string }, result: TResult): Promise<ToolInvocationSuccessResult<TResult>>
	{
		return this.markSucceeded("reservation-1", result);
	}
}

/** Build one immutable snapshot with only the authority facts the runner consumes. */
function _snapshot(identityKind: "user" | "service" = "user"): RunInputSnapshot
{
	return {
		runId: "run-1",
		siloId: "silo-1",
		agentServiceId: "service-1",
		agentRevisionId: "revision-1",
		capabilitySetDigest: "sha256:capabilities",
		identitySnapshot: { kind: identityKind, executionSubjectId: identityKind === "user" ? "user-1" : "agent-service:service-1" },
	} as unknown as RunInputSnapshot;
}

/** Build one upgrade-session candidate with its canonical arguments digest. */
function _candidate(args: JsonValue = { kind: "persona_refresh" }): RuntimeExternalActionCandidate
{
	return { protocolVersion: "opencrane.agent-runtime/v1", runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1", runId: "run-1", attempt: 1, fence: 1, kind: "external_action", toolRevisionId: UPGRADE_SESSION_TOOL_REVISION, toolInvocationId: "invocation-1", argumentsDigest: __DigestCanonicalJson(args), arguments: args };
}

/** Build explicit test authorities while keeping every unrelated transport fail-closed. */
function _dependencies(repository: ToolInvocationRepository = new _InvocationRepository()): ProductionExternalActionRunnerDependencies
{
	return {
		invocations: repository,
		personalConfiguration: { proposeUpgradeSession: vi.fn(async function _propose() { return { changeId: "change-1" }; }) },
		transports: {
			integrations: { resolveAssignment: vi.fn(async function _resolve() { throw new Error("integration transport was not expected"); }) },
			obotMcpInvocation: new __UnavailableObotMcpInvocationAdapter(),
			sandboxExecutor: new __UnavailableSandboxJobExecutor(),
			memoryGateway: new __UnavailableMemoryGatewayClient(),
		},
		approvals: { open: vi.fn(async function _open() { return true; }) },
		clock: { now(): Date { return NOW; } },
		log: { warn: vi.fn() } as unknown as Logger,
	};
}

describe("production external-action runner", function _suite()
{
	it("denies a managed identity before reserving the personal upgrade tool", async function _deniesManagedUpgrade()
	{
		const repository = new _InvocationRepository();
		const dependencies = _dependencies(repository);
		const runner = _CreateProductionExternalActionRunnerWithDependencies(dependencies);

		await expect(runner.run(_candidate(), _snapshot("service"), [UPGRADE_SESSION_TOOL])).resolves.toEqual({ outcome: "denied" });
		expect(repository.intents).toHaveLength(0);
		expect(dependencies.personalConfiguration.proposeUpgradeSession).not.toHaveBeenCalled();
	});

	it("reserves and completes a user upgrade proposal with server-owned time", async function _completesUpgrade()
	{
		const repository = new _InvocationRepository();
		const dependencies = _dependencies(repository);
		const runner = _CreateProductionExternalActionRunnerWithDependencies(dependencies);

		await expect(runner.run(_candidate(), _snapshot(), [UPGRADE_SESSION_TOOL])).resolves.toEqual({ outcome: "completed" });
		expect(repository.intents).toHaveLength(1);
		expect(dependencies.personalConfiguration.proposeUpgradeSession).toHaveBeenCalledWith(_candidate(), _snapshot(), NOW.toISOString());
		expect(dependencies.approvals.open).not.toHaveBeenCalled();
	});

	it.each([
		["required property", {}],
		["property type", { kind: 42 }],
		["additional property", { kind: "persona_refresh", unexpected: true }],
	] satisfies readonly (readonly [string, JsonValue])[])("denies invalid %s before reservation", async function _DeniesInvalidArguments(_case, argumentsValue)
	{
		const repository = new _InvocationRepository();
		const runner = _CreateProductionExternalActionRunnerWithDependencies(_dependencies(repository));

		await expect(runner.run(_candidate(argumentsValue), _snapshot(), [UPGRADE_SESSION_TOOL])).resolves.toEqual({ outcome: "denied" });
		expect(repository.intents).toHaveLength(0);
	});

	it("denies a missing or post-admission mutated schema before reservation", async function _DeniesSchemaDrift()
	{
		const repository = new _InvocationRepository();
		const runner = _CreateProductionExternalActionRunnerWithDependencies(_dependencies(repository));
		const missing = { ...UPGRADE_SESSION_TOOL, parametersSchema: undefined } as unknown as CompiledToolDefinition;
		const mutated = { ...UPGRADE_SESSION_TOOL, parametersSchema: { type: "object", additionalProperties: true } };

		await expect(runner.run(_candidate(), _snapshot(), [missing])).resolves.toEqual({ outcome: "denied" });
		await expect(runner.run(_candidate(), _snapshot(), [mutated])).resolves.toEqual({ outcome: "denied" });
		expect(repository.intents).toHaveLength(0);
	});

	it("opens approval only after reserving an approval-gated action", async function _opensDeferredApproval()
	{
		const effects: string[] = [];
		const repository = new _InvocationRepository(effects);
		const dependencies = _dependencies(repository);
		dependencies.approvals.open = vi.fn(async function _open()
		{
			effects.push("open_approval");
			return true;
		});
		const runner = _CreateProductionExternalActionRunnerWithDependencies(dependencies);
		const approvalTool: CompiledToolDefinition = { ...UPGRADE_SESSION_TOOL, requiresApproval: true };

		await expect(runner.run(_candidate(), _snapshot(), [approvalTool])).resolves.toEqual({ outcome: "completed" });
		expect(repository.intents[0]?.approvalRequired).toBe(true);
		expect(dependencies.personalConfiguration.proposeUpgradeSession).not.toHaveBeenCalled();
		expect(effects).toEqual(["reserve", "open_approval"]);
		expect(dependencies.approvals.open).toHaveBeenCalledWith({
			interruptId: expect.stringMatching(/^sha256:/),
			runId: "run-1",
			attempt: 1,
			toolInvocationId: "invocation-1",
			toolRevisionId: UPGRADE_SESSION_TOOL_REVISION,
			arguments: _candidate().arguments,
			argumentsDigest: _candidate().argumentsDigest,
			parametersSchema: approvalTool.parametersSchema,
			parametersSchemaDigest: approvalTool.parametersSchemaDigest,
			capabilitySetDigest: "sha256:capabilities",
			reservationId: "reservation-1",
			now: NOW,
			expiresAt: new Date("2026-08-02T08:00:00.000Z"),
		});
	});
});
