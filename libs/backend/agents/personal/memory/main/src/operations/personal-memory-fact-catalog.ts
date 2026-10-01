import { MemoryFactProvenanceSourceKinds } from "@opencrane/contracts";

import { PersonalMemoryFactSensitivities } from "./personal-memory-fact-catalog.types";
import type { PersonalMemoryOperationRecord } from "./personal-memory-operation-persistence.types";
import { PersonalMemoryOperationKinds } from "./personal-memory-operation.types";

/** Builds the content-free catalog metadata for an accepted Remember or Correct operation. */
export function _PersonalMemoryFactCreateData(operation: PersonalMemoryOperationRecord, recordedAt: Date)
{
	if ((operation.kind !== PersonalMemoryOperationKinds.Remember && operation.kind !== PersonalMemoryOperationKinds.Correct)
		|| operation.source === null
		|| operation.documentId === null
		|| operation.expectedContentDigest === null)
		return null;
	if (operation.kind === PersonalMemoryOperationKinds.Remember && operation.targetFactId !== null)
		return null;
	if (operation.kind === PersonalMemoryOperationKinds.Correct && operation.targetFactId === null)
		return null;

	return {
		id: operation.operationId,
		datasetId: operation.datasetId,
		cogneeExternalId: operation.documentId,
		contentDigest: operation.expectedContentDigest,
		sensitivity: PersonalMemoryFactSensitivities.Personal,
		provenance: {
			sourceKind: MemoryFactProvenanceSourceKinds.Message,
			operationId: operation.operationId,
			conversationId: operation.source.conversationId,
			messagePosition: operation.source.messagePosition.toString(),
			authorPrincipalId: operation.source.authorPrincipalId,
		},
		sourceArtifactRevisionId: null,
		sourceMessageId: operation.source.messageId,
		supersedesFactId: operation.targetFactId,
		recordedBy: operation.actorPrincipalId,
		recordedAt,
	};
}
