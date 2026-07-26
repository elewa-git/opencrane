import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { MemoryCatalogRepository, RecordMemoryFactCommand, RecordMemoryFactResult } from "./memory-catalog.types.js";

/** Records Cognee fact metadata and provenance without duplicating durable fact content. */
export async function __RecordMemoryFact(repository: MemoryCatalogRepository, command: RecordMemoryFactCommand): Promise<RecordMemoryFactResult>
{
	// 1. Require one explainable source and a content digest, never raw fact content.
	if (!__IsValidMemoryFactCommand(command))
	{
		return { outcome: "denied", reason: "invalid_command" };
	}

	// 2. Persist catalog metadata and the downstream event in one transaction.
	const result = await repository.recordFactAtomically(command);

	// 3. Treat repeat delivery as success while stale datasets or corrections fail closed.
	if (result.status === "recorded") return { outcome: "recorded", idempotent: false };
	if (result.status === "idempotent") return { outcome: "recorded", idempotent: true };
	return { outcome: "denied", reason: result.status };
}

/** Validate source cardinality and bind an explicit statement to its authenticated author. */
export function __IsValidMemoryFactCommand(command: RecordMemoryFactCommand): boolean
{
	const sourceCount = Number(command.source.artifactRevisionId !== null) + Number(command.source.messageId !== null) + Number(command.source.explicitUserStatement);
	if (!command.datasetId.trim() || !command.cogneeExternalId.trim() || !___IsSha256ContentAddress(command.contentDigest) || !command.sensitivity.trim() || !command.recordedBy.trim() || !command.idempotencyKey.trim() || sourceCount !== 1) return false;
	if (!command.source.explicitUserStatement) return command.source.explicitUserId === null && command.provenance["user_statement"] !== true;
	return command.source.explicitUserId !== null
		&& command.source.explicitUserId.trim().length > 0
		&& command.provenance["user_statement"] === true
		&& command.provenance["sourceKind"] === "explicit-user-fact"
		&& command.provenance["sourceUserId"] === command.source.explicitUserId
		&& command.recordedBy === command.source.explicitUserId;
}
