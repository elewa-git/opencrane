import { randomUUID } from "node:crypto";

import { ConversationModes } from "@opencrane/models/conversations";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationCreationReservationOutcomes, type ReserveConversationCreationCommand } from "./conversation-creation-reservation.types";
import { HistoryAnchoredConversationCreationOutcomes } from "./history-anchored-conversation-creation-authority.types";
import { ConversationWriteDenialReasons } from "./types/conversation-authority-result.types";
import type { ConversationCaller } from "./types/conversation-caller.types";
import type { CreateConversationRequest } from "./types/conversation-request.types";
import type { ConversationCreationAuthority, ConversationCreationAuthorityDependencies, ConversationCreationAuthorityResult } from "./conversation-creation-authority.types";

/** Turns a parsed browser request into one immutable, history-authoritative conversation. */
export class HistoryAnchoredConversationCreationService implements ConversationCreationAuthority
{
	/** Holds the narrow server-owned authorities needed before an anchor can be written. */
	public constructor(private readonly dependencies: ConversationCreationAuthorityDependencies) {}

	/** @inheritdoc */
	public async create(caller: ConversationCaller, request: CreateConversationRequest): Promise<ConversationCreationAuthorityResult>
	{
		// 1. Resolve opaque browser references while their membership and resource access are current.
		const compiled = await this.dependencies.compiler.compile(caller, request);
		if (compiled === null)
			return _Denied(request);

		// 2. Freeze an Agent-only binding before a reservation may carry computer coordinates.
		const binding = request.mode === ConversationModes.AgentSession
			? await this.dependencies.agentBindings.bind({ siloId: caller.siloId, agentServiceId: compiled.agentServiceId!, callerPrincipalId: caller.principalId, callerSubjectId: caller.subjectId })
			: null;
		if (binding !== null && !("value" in binding))
			return { outcome: "denied", reason: ConversationWriteDenialReasons.AgentServiceUnavailable };

		// 3. Reserve, anchor, confirm, and project through a caller-bound authority without direct row creation.
		const boundAgent = binding === null || !("value" in binding) ? null : binding.value;
		const command = _Command(caller, request, compiled.participantUserIds, boundAgent, this.dependencies.clock.now());
		const result = await this.dependencies.history.create(caller).create({ reservation: command });
		if (result.outcome === HistoryAnchoredConversationCreationOutcomes.Denied)
			return _Denied(request);
		if (result.outcome === HistoryAnchoredConversationCreationOutcomes.IdempotencyConflict)
			return { outcome: "denied", reason: ConversationWriteDenialReasons.IdempotencyConflict };
		return { outcome: "created", conversationId: result.reservation.conversationId };
	}
}

/** Builds a complete server-resolved durable creation command from checked references and Agent facts. */
function _Command(caller: ConversationCaller, request: CreateConversationRequest, participantUserIds: readonly string[], binding: { readonly agentServiceId: string; readonly agentRevisionId: string; readonly agentIdentityId: string; readonly profileRevisionId: string } | null, createdAt: Date): ReserveConversationCreationCommand
{
	const agent = binding === null
		? null
		: { agentServiceId: binding.agentServiceId, agentRevisionId: binding.agentRevisionId, computerId: randomUUID(), computerHistoryEventId: randomUUID() };
	return {
		siloId: caller.siloId,
		principalId: caller.principalId,
		requestId: request.requestId,
		requestDigest: ___DigestCanonicalJson(request as unknown as JsonValue),
		conversationId: randomUUID(),
		historyEventId: randomUUID(),
		mode: request.mode,
		participants: participantUserIds.map(function _Participant(userId, index) { return { userId, visibleFromPosition: (index + 1).toString(), joinedAt: createdAt.toISOString() }; }),
		agent,
		agentBinding: binding === null ? null : { agentIdentityId: binding.agentIdentityId, profileRevisionId: binding.profileRevisionId },
	};
}

/** Maps failed reference compilation back to the route's existing non-disclosing denial vocabulary. */
function _Denied(request: CreateConversationRequest): ConversationCreationAuthorityResult
{
	return { outcome: "denied", reason: request.mode === ConversationModes.AgentSession ? ConversationWriteDenialReasons.AgentServiceUnavailable : ConversationWriteDenialReasons.ParticipantUnavailable };
}
