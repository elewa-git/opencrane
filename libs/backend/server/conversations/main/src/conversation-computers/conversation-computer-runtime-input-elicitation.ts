import { ___ConversationEntrySchema, ConversationElicitationEntryKinds, ConversationElicitationEntryStates, ConversationEntryKinds, type ElicitationRequestEntry } from "@opencrane/contracts";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { HistoryExpectedRevisions, type HistoryAppendReceipt, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationHistoryReader } from "../conversation-history-reader";
import type { CurrentConversationHistory } from "../conversation-history-reader.types";
import { ConversationComputerHistory } from "./conversation-computer-history";
import type { ConversationComputerRuntimeInputClock, ConversationComputerRuntimeInputElicitationCommand, ConversationComputerRuntimeInputElicitationResult, ConversationComputerRuntimeInputParticipantResolver } from "./conversation-computer-runtime-input-elicitation.types";

/** Limits an ordinary runtime-input request to a short server-owned response window. */
const _RUNTIME_INPUT_TTL_MILLISECONDS = 300_000;

/** Admits a single system-attested RuntimeInput request against checked computer, identity, and transcript heads. */
export class ConversationComputerRuntimeInputElicitationAuthority
{
	public constructor(
		private readonly history: Pick<HistoryStore, "appendAtomic">,
		private readonly computers: Pick<ConversationComputerHistory, "loadActiveExecutionForRuntime">,
		private readonly identities: Pick<AgentIdentityHistory, "loadActiveAuthorization">,
		private readonly conversations: Pick<ConversationHistoryReader, "readCurrent">,
		private readonly participants: ConversationComputerRuntimeInputParticipantResolver,
		private readonly authorization: Pick<AuthorizationAuthority, "admitPrincipal">,
		private readonly clock: ConversationComputerRuntimeInputClock,
	)
	{
	}

	/** Performs exactly one authorization and one atomic KurrentDB append; stale conditions fail closed. */
	public async request(command: ConversationComputerRuntimeInputElicitationCommand): Promise<ConversationComputerRuntimeInputElicitationResult>
	{
		_Validate(command);
		const now = this.clock.now();

		// 1. Replay the current transcript so a response-lost retry returns its durable winner.
		const conversation = await this.conversations.readCurrent({
			siloId: command.siloId,
			conversationId: command.conversationId,
		});
		const existingReceipt = _ExistingRequestReceipt(conversation, command);
		if (existingReceipt !== null)
			return { receipt: existingReceipt };

		// 2. Check the active runtime state so callers cannot choose the actor, lease, or execution.
		const computer = await this.computers.loadActiveExecutionForRuntime({
			siloId: command.siloId,
			computerId: command.computerId,
			conversationId: command.conversationId,
			profileRevisionId: command.profileRevisionId,
			nowEpochMilliseconds: now.getTime(),
		});
		const identity = await this.identities.loadActiveAuthorization({
			siloId: command.siloId,
			agentIdentityId: computer.computer.agentIdentityId,
		});
		const participant = await this.participants.resolve({
			siloId: command.siloId,
			conversationId: command.conversationId,
			computerId: computer.computer.id,
			agentIdentityId: identity.identity.id,
		});
		if (!_Id(participant.participantId))
			throw new Error("Conversation computer runtime input could not resolve an active participant");

		// 3. Admit the derived principal with a digest that binds this exact runtime request.
		const admission = await this.authorization.admitPrincipal({
			siloId: command.siloId,
			principalId: identity.principalId,
			actorKind: identity.actorKind,
			actorId: identity.actorId,
			resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: command.conversationId },
			action: ProductAuthorizationActions.Use,
			argumentsDigest: ___DigestCanonicalJson(_Args(command, computer.execution.id, computer.lease.generation, participant.participantId)),
			nowEpochMs: now.getTime(),
		});
		if (admission.outcome !== AuthorizationDecisionOutcomes.Allow || admission.evidence === null)
			throw new Error("Conversation computer runtime input was denied by current authorization");
		const entry = _Entry(command, computer, conversation.expectedRevision, participant.participantId, admission.evidence.decisionEvidenceId, now);
		if (!___ConversationEntrySchema.safeParse(entry).success)
			throw new Error("Conversation computer runtime input could not stamp a valid participant entry");

		// 4. Append under all checked heads so any concurrent authority change rejects the request.
		const receipts = await this.history.appendAtomic({
			expectedHeads: [
				{ streamName: computer.streamName, revision: computer.revision },
				{ streamName: conversation.streamName, revision: conversation.expectedRevision },
				...identity.expectedIdentityHeads,
			],
			appends: [{
				streamName: conversation.streamName,
				expectedRevision: conversation.expectedRevision,
				events: [{
					id: entry.id,
					type: "opencrane.conversation-entry.v1",
					data: { entry },
					metadata: {
						siloId: command.siloId,
						conversationId: command.conversationId,
						causationId: command.causationId,
						correlationId: command.correlationId,
						idempotencyKey: command.requestId,
					},
				}],
			}],
		});
		const receipt = receipts.find(candidate => candidate.streamName === conversation.streamName);
		if (receipt === undefined)
			throw new Error("Conversation computer runtime input atomic append omitted its conversation receipt");
		return { receipt };
	}
}

/** Returns the original receipt only when the durable request winner exactly matches the retry. */
function _ExistingRequestReceipt(conversation: CurrentConversationHistory, command: ConversationComputerRuntimeInputElicitationCommand): HistoryAppendReceipt | null
{
	const entry = conversation.entries.find(candidate => candidate.idempotencyKey === command.requestId);
	if (entry === undefined)
		return null;
	const isExactRuntimeInput = entry.kind === ConversationEntryKinds.Elicitation
		&& entry.elicitationKind === ConversationElicitationEntryKinds.RuntimeInput
		&& entry.state === ConversationElicitationEntryStates.Requested
		&& entry.conversationId === command.conversationId
		&& entry.elicitationId === command.elicitationId
		&& entry.computerId === command.computerId
		&& entry.requestPayloadRef === command.requestPayloadRef
		&& entry.requestPayloadDigest === command.requestPayloadDigest
		&& entry.causationId === command.causationId
		&& entry.correlationId === command.correlationId
		&& entry.attestation !== null
		&& entry.attestation.receiptId === command.requestId;
	if (!isExactRuntimeInput)
		throw new Error("Conversation computer runtime input idempotency key already owns a different request");
	return { streamName: conversation.streamName, revision: BigInt(entry.position) };
}

/** Builds the immutable conversation entry from server-derived runtime authority. */
function _Entry(command: ConversationComputerRuntimeInputElicitationCommand, computer: Awaited<ReturnType<ConversationComputerHistory["loadActiveExecutionForRuntime"]>>, conversationRevision: HistoryExpectedRevisions.NoStream | bigint, participantId: string, decisionEvidenceId: string, now: Date): ElicitationRequestEntry
{
	const position = conversationRevision === HistoryExpectedRevisions.NoStream
		? "0"
		: (conversationRevision + 1n).toString();
	return {
		schemaVersion: 1,
		id: command.requestId,
		conversationId: command.conversationId,
		position,
		author: { kind: "system", systemId: "opencrane", name: "OpenCrane" },
		provenance: "service-attested",
		visibility: { audience: "participant_subset", participantIds: [participantId] },
		causationId: command.causationId,
		correlationId: command.correlationId,
		idempotencyKey: command.requestId,
		occurredAt: now.toISOString(),
		attestation: {
			serviceId: "opencrane",
			receiptId: command.requestId,
			domainStream: computer.streamName,
			domainRevision: computer.revision.toString(),
			decisionEvidenceId,
		},
		kind: ConversationEntryKinds.Elicitation,
		elicitationId: command.elicitationId,
		computerId: computer.computer.id,
		computerExecutionId: computer.execution.id,
		leaseGeneration: computer.lease.generation,
		elicitationKind: ConversationElicitationEntryKinds.RuntimeInput,
		state: ConversationElicitationEntryStates.Requested,
		addressedParticipantId: participantId,
		requestPayloadRef: command.requestPayloadRef,
		requestPayloadDigest: command.requestPayloadDigest,
		expiresAt: new Date(now.getTime() + _RUNTIME_INPUT_TTL_MILLISECONDS).toISOString(),
	};
}

/** Builds the authorization digest input for the server-derived runtime request. */
function _Args(command: ConversationComputerRuntimeInputElicitationCommand, executionId: string, leaseGeneration: number, participantId: string): JsonValue
{
	return {
		action: "runtime_input",
		computerId: command.computerId,
		conversationId: command.conversationId,
		executionId,
		leaseGeneration,
		elicitationId: command.elicitationId,
		participantId,
		requestPayloadDigest: command.requestPayloadDigest,
	};
}

/** Rejects caller-supplied values that cannot safely name one runtime request. */
function _Validate(command: ConversationComputerRuntimeInputElicitationCommand): void
{
	const identifiers = [command.siloId, command.computerId, command.conversationId, command.profileRevisionId, command.requestId, command.elicitationId, command.causationId, command.correlationId];
	for (const value of identifiers)
	{
		if (!_Id(value))
			throw new Error("Conversation computer runtime input requires server-provided coordinates");
	}
	const hasValidRequestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(command.requestId);
	const hasValidPayloadRef = /^payload:\/\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(command.requestPayloadRef);
	const hasValidPayloadDigest = /^sha256:[a-f0-9]{64}$/u.test(command.requestPayloadDigest);
	if (!hasValidRequestId || !hasValidPayloadRef || !hasValidPayloadDigest)
		throw new Error("Conversation computer runtime input requires valid request coordinates");
}

/** Accepts a nonblank identifier only when it has no surrounding whitespace. */
function _Id(value: string): boolean
{
	return value.trim().length > 0 && value === value.trim();
}
