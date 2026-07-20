import type { AgentRevision } from "@opencrane/models/agents";

import type { AgentServicePublicationRepository, PublishAgentRevisionCommand, PublishAgentRevisionFailureReason, PublishAgentRevisionResult } from "./agent-publication.types.js";

/** Returns whether a string carries a non-empty value after trimming. */
function _isPresent(value: string): boolean
{
	return value.trim().length > 0;
}

/** Returns whether an immutable draft has the minimum executable publication fields. */
function _isPublishableRevision(revision: AgentRevision): boolean
{
	return Number.isSafeInteger(revision.revision)
		&& revision.revision > 0
		&& _isPresent(revision.id)
		&& _isPresent(revision.agentServiceId)
		&& _isPresent(revision.digest)
		&& _isPresent(revision.promptPolicyVersion)
		&& _isPresent(revision.modelPolicyId)
		&& Number.isSafeInteger(revision.budget.maxTurns)
		&& revision.budget.maxTurns > 0
		&& Number.isSafeInteger(revision.budget.maxTokens)
		&& revision.budget.maxTokens > 0
		&& Number.isSafeInteger(revision.budget.maxDurationMs)
		&& revision.budget.maxDurationMs > 0;
}

/** Creates a denied publication result. */
function _deny(reason: PublishAgentRevisionFailureReason): PublishAgentRevisionResult
{
	return { outcome: "denied", reason };
}

/**
 * Publishes one immutable AgentRevision and atomically changes the stable AgentService pointer.
 * The repository owns the compare-and-swap so two concurrent publishers cannot both win.
 * @param repository - Authoritative service and revision persistence boundary.
 * @param command - Publication command carrying the caller's observed active revision.
 * @returns Published records or a fail-closed reason.
 */
export async function __PublishAgentRevision(repository: AgentServicePublicationRepository, command: PublishAgentRevisionCommand): Promise<PublishAgentRevisionResult>
{
	// 1. Reject malformed identifiers and time before consulting authority state.
	if (!_isPresent(command.agentServiceId) || !_isPresent(command.agentRevisionId) || !Number.isFinite(Date.parse(command.publishedAt)))
	{
		return _deny("invalid_command");
	}

	// 2. Load the stable identity and immutable draft independently so missing authority fails closed.
	const service = await repository.getService(command.agentServiceId);
	if (service === null)
	{
		return _deny("service_not_found");
	}
	if (service.state === "retired")
	{
		return _deny("service_retired");
	}
	const revision = await repository.getRevision(command.agentRevisionId);
	if (revision === null)
	{
		return _deny("revision_not_found");
	}

	// 3. Validate ownership and executable immutability before attempting the atomic publication.
	if (revision.agentServiceId !== service.id)
	{
		return _deny("revision_service_mismatch");
	}
	if (revision.state !== "draft" || revision.publishedAt !== null)
	{
		return _deny("revision_not_draft");
	}
	if (!_isPublishableRevision(revision))
	{
		return _deny("invalid_revision");
	}

	// 4. Compare-and-swap the published revision and active pointer as one authority transaction.
	const publication = await repository.publishRevisionAtomically({
		agentServiceId: service.id,
		expectedServiceState: service.state,
		agentRevisionId: revision.id,
		expectedActiveRevisionId: command.expectedActiveRevisionId,
		publishedAt: command.publishedAt,
	});
	if (publication.status === "conflict")
	{
		return { outcome: "denied", reason: "publication_conflict", currentActiveRevisionId: publication.currentActiveRevisionId };
	}

	return { outcome: "published", service: publication.service, revision: publication.revision };
}
