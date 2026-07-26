import type { PrismaClient } from "@prisma/client";
import { __CreateCapabilitySet } from "@opencrane/backend/server/iam/authorization";
import { AGENT_RUNTIME_PROTOCOL_V1, type RunInputSnapshot, type RuntimeChildRunSpawnCandidate } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { PrismaRuntimeChildRunSpawnRunner } from "../prisma-runtime-child-run-spawn-runner.js";

const _PARENT_CAPABILITY_SET = __CreateCapabilitySet([{ catalog: { catalogId: "catalog-1", revision: 1, digest: `sha256:${"a".repeat(64)}` }, capabilityId: "artifact.read" }, { catalog: { catalogId: "catalog-1", revision: 1, digest: `sha256:${"a".repeat(64)}` }, capabilityId: "artifact.write" }])!;
const _CHILD_CAPABILITY_SET = __CreateCapabilitySet([_PARENT_CAPABILITY_SET.capabilities[0]!])!;

/** Builds a complete frozen parent snapshot with both a readable and a non-delegable capability. */
function _snapshot(): RunInputSnapshot
{
	return {
		runId: "parent-run-1", siloId: "silo-1", agentServiceId: "parent-service-1", agentRevisionId: "parent-revision-1", snapshotVersion: 2, threadId: "thread-1", messageIds: ["message-1"], personaRevisionId: "persona-1", preferenceFactIds: ["preference-1"], artifactRevisionIds: ["artifact-1"], skillRevisionIds: ["skill-1"], memoryFacts: [{ datasetId: "dataset-1", factId: "fact-1", contentDigest: `sha256:${"b".repeat(64)}`, provenance: [] }], memoryQueryPolicy: {}, integrationAssignments: [], modelRoute: {}, budgetPolicy: { maxModelTurns: 4, maxTotalTokens: 1_000, maxCostUsdMicros: 500_000, wallClockDeadlineEpochMs: Date.parse("2026-07-26T00:02:00.000Z") }, identitySnapshot: { executionSubjectId: "user-1", organizationId: "org-1", fleetMembershipRevision: 1, fleetMembershipIssuer: "issuer", fleetMembershipIssuerKeyId: "key", fleetMembershipAssertionId: "assertion", fleetMembershipPayloadDigest: `sha256:${"c".repeat(64)}`, fleetMembershipTrustedUntil: "2026-07-27T00:00:00.000Z" }, capabilitySetDigest: _PARENT_CAPABILITY_SET.digest, capabilitySet: _PARENT_CAPABILITY_SET.capabilities, effectiveContractDigest: `sha256:${"d".repeat(64)}`, promptCompilerVersion: "prompt-v1", digest: `sha256:${"e".repeat(64)}`, compiledAt: "2026-07-26T00:00:00.000Z",
	};
}

/** Builds one runtime candidate whose digest names only the target's narrower capability ceiling. */
function _candidate(): RuntimeChildRunSpawnCandidate
{
	return { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1", runId: "parent-run-1", attempt: 1, fence: 1, kind: "child_run_spawn", agentServiceId: "child-service-1", capabilitySetDigest: _CHILD_CAPABILITY_SET.digest, context: { messageIds: ["message-1"], memoryFactIds: ["fact-1"], artifactRevisionIds: ["artifact-1"], skillRevisionIds: ["skill-1"] }, budget: { maxModelTurns: 2, maxTotalTokens: 300, maxCostUsdMicros: 200_000, maxDurationMs: 60_000 }, task: { goal: "summarise" } };
}

/** Creates the locked parent row returned by the reservation repository. */
function _parentRun()
{
	return { id: "parent-run-1", siloId: "silo-1", agentServiceId: "parent-service-1", parentRunId: null, rootRunId: "parent-run-1", state: "Running", attempt: 1, inputSnapshotDigest: `sha256:${"e".repeat(64)}` };
}

/** Creates one Prisma mock that exposes the parent, target revision, and atomic persistence sinks. */
function _prisma()
{
	const parent = _snapshot();
	const transaction = {
		$queryRaw: vi.fn().mockResolvedValue([]),
		agentRun: { findUnique: vi.fn().mockResolvedValueOnce(_parentRun()).mockResolvedValueOnce(null), create: vi.fn().mockResolvedValue({ id: "child-run-1" }) },
		runInputSnapshot: { findUnique: vi.fn().mockResolvedValue({ ...parent, compiledAt: new Date(parent.compiledAt) }), create: vi.fn().mockResolvedValue({ id: "snapshot-1" }) },
		childRunReservation: { findUnique: vi.fn(), aggregate: vi.fn().mockResolvedValue({ _count: { childRunId: 0 }, _sum: { maxModelTurns: null, maxTotalTokens: null, maxCostUsdMicros: null, maxDurationMs: null } }), create: vi.fn().mockResolvedValue({ childRunId: "child-run-1" }) },
		agentService: { findFirst: vi.fn().mockResolvedValue({ id: "child-service-1", activeRevision: { id: "child-revision-1", state: "Published", digest: `sha256:${"f".repeat(64)}`, promptPolicyVersion: "prompt-v1", capabilityCeiling: _CHILD_CAPABILITY_SET.capabilities } }) },
		outboxEvent: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
	};
	return { client: { $transaction: vi.fn(async function _transaction(callback: (client: object) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient, transaction };
}

describe("PrismaRuntimeChildRunSpawnRunner", function _describeRuntimeChildRunSpawnRunner()
{
	it("locks the target revision, verifies the narrowed capability set, and persists the child under its parent lock", async function _runsChildAuthority()
	{
		const prisma = _prisma();
		const runner = new PrismaRuntimeChildRunSpawnRunner(prisma.client, { maximumDepth: 2, maximumChildrenPerParent: 3 }, function _now(): number { return Date.parse("2026-07-26T00:00:00.000Z"); });

		await expect(runner.run(_candidate(), _snapshot())).resolves.toEqual({ outcome: "completed" });
		expect(prisma.transaction.$queryRaw).toHaveBeenCalledTimes(3);
		expect(prisma.transaction.agentService.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "child-service-1", siloId: "silo-1", state: "Active" }) }));
		expect(prisma.transaction.agentRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ agentServiceId: "child-service-1", agentRevisionId: "child-revision-1", parentRunId: "parent-run-1", rootRunId: "parent-run-1" }) });
		expect(prisma.transaction.runInputSnapshot.create).toHaveBeenCalledWith({ data: expect.objectContaining({ capabilitySetDigest: _CHILD_CAPABILITY_SET.digest, capabilitySet: _CHILD_CAPABILITY_SET.capabilities }) });
	});

	it("denies an unverified child capability digest without creating a child run", async function _deniesCapabilityExpansion()
	{
		const prisma = _prisma();
		const runner = new PrismaRuntimeChildRunSpawnRunner(prisma.client, { maximumDepth: 2, maximumChildrenPerParent: 3 }, function _now(): number { return Date.parse("2026-07-26T00:00:00.000Z"); });

		await expect(runner.run({ ..._candidate(), capabilitySetDigest: _PARENT_CAPABILITY_SET.digest }, _snapshot())).resolves.toEqual({ outcome: "denied" });
		expect(prisma.transaction.agentRun.create).not.toHaveBeenCalled();
	});

	it("denies a late child whose requested duration extends beyond the frozen parent deadline", async function _deniesLateChild()
	{
		const prisma = _prisma();
		const runner = new PrismaRuntimeChildRunSpawnRunner(prisma.client, { maximumDepth: 2, maximumChildrenPerParent: 3 }, function _now(): number { return Date.parse("2026-07-26T00:01:59.000Z"); });

		await expect(runner.run(_candidate(), _snapshot())).resolves.toEqual({ outcome: "denied" });
		expect(prisma.transaction.agentRun.create).not.toHaveBeenCalled();
	});

	it("denies a candidate after its locked parent has left the running attempt", async function _deniesTerminalParent()
	{
		const prisma = _prisma();
		prisma.transaction.agentRun.findUnique.mockReset().mockResolvedValue({ ..._parentRun(), state: "Completed" });
		const runner = new PrismaRuntimeChildRunSpawnRunner(prisma.client, { maximumDepth: 2, maximumChildrenPerParent: 3 }, function _now(): number { return Date.parse("2026-07-26T00:00:00.000Z"); });

		await expect(runner.run(_candidate(), _snapshot())).resolves.toEqual({ outcome: "denied" });
		expect(prisma.transaction.agentRun.create).not.toHaveBeenCalled();
		expect(prisma.transaction.agentService.findFirst).not.toHaveBeenCalled();
	});
});
