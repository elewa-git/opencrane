import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { RunInputSnapshot } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

/**
 * Produces the content identity of every authority-frozen runtime input without hashing the digest
 * into itself. Callers must canonicalise set-like source arrays before invoking it; ordered message
 * history and provenance remain deliberately order-sensitive where their order carries meaning.
 */
export function __DigestRunInputSnapshot(snapshot: Omit<RunInputSnapshot, "digest">): string
{
	return __DigestCanonicalJson({
		runId: snapshot.runId,
		siloId: snapshot.siloId,
		agentServiceId: snapshot.agentServiceId,
		agentRevisionId: snapshot.agentRevisionId,
		snapshotVersion: snapshot.snapshotVersion,
		threadId: snapshot.threadId,
		messageIds: snapshot.messageIds,
		personaRevisionId: snapshot.personaRevisionId,
		preferenceFactIds: snapshot.preferenceFactIds,
		artifactRevisionIds: snapshot.artifactRevisionIds,
		skillRevisionIds: snapshot.skillRevisionIds,
		memoryFacts: snapshot.memoryFacts.map(function _memoryFact(fact): JsonValue
		{
			return {
				datasetId: fact.datasetId,
				factId: fact.factId,
				contentDigest: fact.contentDigest,
				provenance: fact.provenance.map(function _provenance(provenance): JsonValue
				{
					return {
						sourceKind: provenance.sourceKind,
						sourceId: provenance.sourceId,
						...(provenance.artifactRevisionId === undefined ? {} : { artifactRevisionId: provenance.artifactRevisionId }),
						...(provenance.sourceUserId === undefined ? {} : { sourceUserId: provenance.sourceUserId }),
						capturedAt: provenance.capturedAt,
					};
				}),
			};
		}),
		memoryQueryPolicy: snapshot.memoryQueryPolicy,
		toolGrantIds: snapshot.toolGrantIds,
		modelRoute: snapshot.modelRoute,
		budgetPolicy: snapshot.budgetPolicy,
		identitySnapshot: snapshot.identitySnapshot,
		capabilitySetDigest: snapshot.capabilitySetDigest,
		effectiveContractDigest: snapshot.effectiveContractDigest,
		promptCompilerVersion: snapshot.promptCompilerVersion,
		compiledAt: snapshot.compiledAt,
	} as unknown as JsonValue);
}
