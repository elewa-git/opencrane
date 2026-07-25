import type { RunInputSnapshot } from "@opencrane/contracts";
import { __CreateCapabilitySet } from "@opencrane/backend/server/iam/authorization";
import { describe, expect, it } from "vitest";

import { __DeriveChildRunSnapshot } from "../child-run-snapshot.js";
import type { ChildRunSnapshotCommand } from "../child-run-snapshot.types.js";

/** Fixed parent snapshot with more authority than one child may receive. */
const _parent: RunInputSnapshot = { runId: "parent-run", siloId: "silo-a", agentServiceId: "parent-service", agentRevisionId: "parent-revision", snapshotVersion: 1, threadId: "thread-1", messageIds: ["message-1", "message-2"], personaRevisionId: "persona-1", preferenceFactIds: ["preference-1"], artifactRevisionIds: ["artifact-1", "artifact-2"], skillRevisionIds: ["skill-1", "skill-2"], memoryFacts: [{ datasetId: "dataset-1", factId: "fact-1", contentDigest: `sha256:${"a".repeat(64)}`, provenance: [] }, { datasetId: "dataset-1", factId: "fact-2", contentDigest: `sha256:${"b".repeat(64)}`, provenance: [] }], memoryQueryPolicy: { allowed: true }, integrationAssignments: [{ integrationId: "integration-1", allowedTools: ["tool-1"] }], modelRoute: { modelDefinitionId: "model-1" }, budgetPolicy: { maxModelTurns: 8 }, identitySnapshot: { executionSubjectId: "user-1", fleetMembershipRevision: 2, fleetMembershipIssuer: "issuer", fleetMembershipIssuerKeyId: "key", fleetMembershipAssertionId: "assertion", fleetMembershipPayloadDigest: `sha256:${"c".repeat(64)}`, fleetMembershipTrustedUntil: "2026-07-27T00:00:00.000Z" }, capabilitySetDigest: `sha256:${"d".repeat(64)}`, capabilitySet: [], effectiveContractDigest: `sha256:${"e".repeat(64)}`, promptCompilerVersion: "parent-v1", digest: `sha256:${"f".repeat(64)}`, compiledAt: "2026-07-26T00:00:00.000Z" };

/** Builds a fully authorised, server-selected child snapshot command. */
function _command(): ChildRunSnapshotCommand
{
	const capabilitySet = __CreateCapabilitySet([])!;
	return { childRunId: "child-run", parentSnapshot: _parent, authorization: { siloId: "silo-a", rootRunId: "root-run", parentRunId: "parent-run", depth: 1, capabilitySetDigest: capabilitySet.digest, capabilitySet, agentServiceId: "child-service", context: { messageIds: ["message-2"], memoryFactIds: ["fact-2"], artifactRevisionIds: ["artifact-2"], skillRevisionIds: ["skill-2"] }, budget: { maxModelTurns: 2, maxTotalTokens: 200, maxCostUsdMicros: 2000000, maxDurationMs: 30000 }, task: { objective: "Summarise." } }, agentRevisionId: "child-revision", effectiveContractDigest: `sha256:${"2".repeat(64)}`, promptCompilerVersion: "child-v1", compiledAt: "2026-07-26T00:01:00.000Z" };
}

describe("__DeriveChildRunSnapshot", function _describeChildRunSnapshot()
{
	it("copies only parent-authorised context and seals the finite child allocation", function _derivesSubset()
	{
		const snapshot = __DeriveChildRunSnapshot(_command());

		expect(snapshot).toMatchObject({ runId: "child-run", agentServiceId: "child-service", agentRevisionId: "child-revision", messageIds: ["message-2"], artifactRevisionIds: ["artifact-2"], skillRevisionIds: ["skill-2"], memoryFacts: [expect.objectContaining({ factId: "fact-2" })], capabilitySetDigest: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", effectiveContractDigest: `sha256:${"2".repeat(64)}`, budgetPolicy: { maxModelTurns: 2, maxTotalTokens: 200, maxCostUsdMicros: 2000000, wallClockDeadlineEpochMs: Date.parse("2026-07-26T00:01:00.000Z") + 30000 } });
		expect(snapshot.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
	});

	it("returns the same digest for the same frozen parent and server-owned command", function _isDeterministic()
	{
		expect(__DeriveChildRunSnapshot(_command()).digest).toBe(__DeriveChildRunSnapshot(_command()).digest);
	});
});
