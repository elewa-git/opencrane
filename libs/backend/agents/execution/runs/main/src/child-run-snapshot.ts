import { ___CloneCanonicalJson } from "@opencrane/util";
import type { RunInputSnapshot } from "@opencrane/contracts";

import { __DigestRunInputSnapshot } from "./run-input-snapshot-digest.js";
import type { ChildRunSnapshotCommand } from "./child-run-snapshot.types.js";

/** Derives a digest-sealed child snapshot without reading mutable authority or widening parent inputs. */
export function __DeriveChildRunSnapshot(command: ChildRunSnapshotCommand): RunInputSnapshot
{
	const parent = command.parentSnapshot;
	const context = command.authorization.context;
	const budget = command.authorization.budget;
	const snapshot = _snapshot({
		runId: command.childRunId,
		siloId: command.authorization.siloId,
		agentServiceId: command.authorization.agentServiceId,
		agentRevisionId: command.agentRevisionId,
		snapshotVersion: parent.snapshotVersion,
		threadId: parent.threadId,
		messageIds: [...context.messageIds],
		personaRevisionId: parent.personaRevisionId,
		preferenceFactIds: [...parent.preferenceFactIds],
		artifactRevisionIds: [...context.artifactRevisionIds],
		skillRevisionIds: [...context.skillRevisionIds],
		memoryFacts: context.memoryFactIds.map(function _memoryFact(factId) { return parent.memoryFacts.find(function _matchesFact(fact) { return fact.factId === factId; }); }).filter(function _presentFact(fact): fact is NonNullable<typeof fact> { return fact !== undefined; }),
		memoryQueryPolicy: ___CloneCanonicalJson(parent.memoryQueryPolicy),
		integrationAssignments: parent.integrationAssignments.map(function _integration(assignment) { return { integrationId: assignment.integrationId, allowedTools: [...assignment.allowedTools] }; }),
		modelRoute: ___CloneCanonicalJson(parent.modelRoute),
		budgetPolicy: { maxModelTurns: budget.maxModelTurns, maxTotalTokens: budget.maxTotalTokens, maxCostUsdMicros: budget.maxCostUsdMicros, wallClockDeadlineEpochMs: Date.parse(command.compiledAt) + budget.maxDurationMs },
		identitySnapshot: { executionSubjectId: parent.identitySnapshot.executionSubjectId, organizationId: parent.identitySnapshot.organizationId, fleetMembershipRevision: parent.identitySnapshot.fleetMembershipRevision, fleetMembershipIssuer: parent.identitySnapshot.fleetMembershipIssuer, fleetMembershipIssuerKeyId: parent.identitySnapshot.fleetMembershipIssuerKeyId, fleetMembershipAssertionId: parent.identitySnapshot.fleetMembershipAssertionId, fleetMembershipPayloadDigest: parent.identitySnapshot.fleetMembershipPayloadDigest, fleetMembershipTrustedUntil: parent.identitySnapshot.fleetMembershipTrustedUntil },
		capabilitySetDigest: command.authorization.capabilitySetDigest,
		capabilitySet: command.authorization.capabilitySet.capabilities,
		effectiveContractDigest: command.effectiveContractDigest,
		promptCompilerVersion: command.promptCompilerVersion,
		compiledAt: command.compiledAt,
	});
	return { ...snapshot, digest: __DigestRunInputSnapshot(snapshot) };
}

/** Preserves the exact cross-domain snapshot contract before its digest is calculated. */
function _snapshot(value: Omit<RunInputSnapshot, "digest">): Omit<RunInputSnapshot, "digest">
{
	return value;
}
