import { randomUUID } from "node:crypto";

import { ConversationModes } from "@opencrane/models/conversations";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ReserveConversationCreationCommand } from "./conversation-creation-reservation.types";
import { HistoryAnchoredConversationCreationOutcomes, type HistoryAnchoredConversationCreationResult } from "./history-anchored-conversation-creation-authority.types";
import { ConversationWriteDenialReasons } from "./types/conversation-authority-result.types";
import type { ConversationAgentBindingResult } from "./conversation-agent-binding.types";
import type { ConversationCaller } from "./types/conversation-caller.types";
import type { CreateConversationRequest } from "./types/conversation-request.types";
import type { ConversationCreationAuthority, ConversationCreationAuthorityDependencies, ConversationCreationAuthorityResult } from "./conversation-creation-authority.types";

/** Bounds the first Agent Sandbox claim while its durable activation consumer begins reconciliation. */
const _INITIAL_COMPUTER_LEASE_MILLISECONDS = 20 * 60 * 1_000;

/**
 * Turns a parsed browser request into one immutable, history-authoritative conversation.
 *
 * The service recovers a matching request id before it reads mutable access or Agent facts. Once
 * an Agent conversation anchor is confirmed, it also establishes the frozen first computer
 * generation and activation event. OpenCrane therefore owns the lifecycle record; the later
 * activation worker alone asks the Agent Sandbox controller for the matching claim.
 * @implements ConversationCreationAuthority
 */
export class HistoryAnchoredConversationCreationService implements ConversationCreationAuthority
{
	/** Holds the narrow server-owned authorities needed before an anchor can be written. */
	public constructor(private readonly dependencies: ConversationCreationAuthorityDependencies) {}

	/** @inheritdoc */
	public async create(caller: ConversationCaller, request: CreateConversationRequest): Promise<ConversationCreationAuthorityResult>
	{
		const requestDigest = ___DigestCanonicalJson(request as unknown as JsonValue);
		const history = this.dependencies.history.create(caller);
		// 1. Resume a known command before mutable references or Agent policy can strand its anchor.
		const recovered = await history.resume({ requestId: request.requestId, requestDigest });
		if (recovered !== null)
			return _Result(recovered, request, this.dependencies.computers);
		// 2. Resolve opaque browser references while their membership and resource access are current.
		const compiled = await this.dependencies.compiler.compile(caller, request);
		if (compiled === null)
			return _Denied(request);
		// 3. Freeze an Agent-only binding before a reservation may carry computer coordinates.
		let binding: ConversationAgentBindingResult | null = null;
		if (request.mode === ConversationModes.AgentSession)
		{
			const agentServiceId = compiled.agentServiceId;
			if (agentServiceId === null)
				return _Denied(request);
			binding = await this.dependencies.agentBindings.bind({ siloId: caller.siloId, agentServiceId, callerPrincipalId: caller.principalId, callerSubjectId: caller.subjectId });
		}
		if (binding !== null && !("value" in binding))
			return { outcome: "denied", reason: ConversationWriteDenialReasons.AgentServiceUnavailable };

		// 4. Reserve, anchor, confirm, and project through a caller-bound authority without direct row creation.
		const boundAgent = binding === null || !("value" in binding) ? null : binding.value;
		const command = _Command(caller, request, requestDigest, compiled.participantUserIds, boundAgent, this.dependencies.clock.now());
		const result = await history.create({ reservation: command });
		return _Result(result, request, this.dependencies.computers);
	}
}

/**
 * Maps history results to the route result after Agent conversations establish their first computer.
 *
 * Recovering an accepted request must run the same activation check because an earlier response may
 * have been lost after history appended but before the caller received a result.
 */
async function _Result(result: HistoryAnchoredConversationCreationResult, request: CreateConversationRequest, computers: import("./conversation-computer-creation-activation-authority.types").ConversationComputerCreationActivationAuthority): Promise<ConversationCreationAuthorityResult>
{
	if (result.outcome === HistoryAnchoredConversationCreationOutcomes.Denied)
		return _Denied(request);
	if (result.outcome === HistoryAnchoredConversationCreationOutcomes.IdempotencyConflict)
		return { outcome: "denied", reason: ConversationWriteDenialReasons.IdempotencyConflict };
	await computers.ensure(result.reservation);
	return { outcome: "created", conversationId: result.reservation.conversationId };
}

/** Builds a complete server-resolved durable creation command from checked references and Agent facts. */
function _Command(caller: ConversationCaller, request: CreateConversationRequest, requestDigest: `sha256:${string}`, participantUserIds: readonly string[], binding: { readonly agentServiceId: string; readonly agentRevisionId: string; readonly agentIdentityId: string; readonly profileRevisionId: string } | null, createdAt: Date): ReserveConversationCreationCommand
{
	const agent = binding === null
		? null
		: _AgentCoordinates(binding, createdAt);
	return {
		siloId: caller.siloId,
		principalId: caller.principalId,
		requestId: request.requestId,
		requestDigest,
		conversationId: randomUUID(),
		historyEventId: randomUUID(),
		mode: request.mode,
		participants: participantUserIds.map(function _Participant(userId, index) { return { userId, visibleFromPosition: (index + 1).toString(), joinedAt: createdAt.toISOString() }; }),
		agent,
		agentBinding: binding === null ? null : { agentIdentityId: binding.agentIdentityId, profileRevisionId: binding.profileRevisionId },
	};
}

/** Freezes every first-lease coordinate before history I/O makes a retry externally visible. */
function _AgentCoordinates(binding: { readonly agentServiceId: string; readonly agentRevisionId: string }, createdAt: Date)
{
	return { agentServiceId: binding.agentServiceId, agentRevisionId: binding.agentRevisionId, computerId: `computer-${randomUUID()}`, computerHistoryEventId: randomUUID(), computerClaimEventId: randomUUID(), computerActivationEventId: randomUUID(), computerLeaseClaimedAt: createdAt.toISOString(), computerLeaseExpiresAt: new Date(createdAt.getTime() + _INITIAL_COMPUTER_LEASE_MILLISECONDS).toISOString() };
}

/** Maps failed reference compilation back to the route's existing non-disclosing denial vocabulary. */
function _Denied(request: CreateConversationRequest): ConversationCreationAuthorityResult
{
	return { outcome: "denied", reason: request.mode === ConversationModes.AgentSession ? ConversationWriteDenialReasons.AgentServiceUnavailable : ConversationWriteDenialReasons.ParticipantUnavailable };
}
