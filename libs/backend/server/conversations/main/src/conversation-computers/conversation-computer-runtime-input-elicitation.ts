import { ___ConversationEntrySchema, ConversationElicitationEntryKinds, ConversationElicitationEntryStates, ConversationEntryKinds, type ElicitationRequestEntry } from "@opencrane/contracts";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { HistoryExpectedRevisions, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationHistoryReader } from "../conversation-history-reader";
import { ConversationComputerHistory } from "./conversation-computer-history";
import type { ConversationComputerRuntimeInputClock, ConversationComputerRuntimeInputElicitationCommand, ConversationComputerRuntimeInputElicitationResult, ConversationComputerRuntimeInputParticipantResolver } from "./conversation-computer-runtime-input-elicitation.types";

/** Limits an ordinary runtime-input request to a short server-owned response window. */
const _RUNTIME_INPUT_TTL_MILLISECONDS = 300_000;

/** Admits a single system-attested RuntimeInput request against checked computer, identity, and transcript heads. */
export class ConversationComputerRuntimeInputElicitationAuthority
{
	public constructor(private readonly history: Pick<HistoryStore, "appendAtomic">, private readonly computers: Pick<ConversationComputerHistory, "loadActiveExecutionForRuntime">, private readonly identities: Pick<AgentIdentityHistory, "loadActiveAuthorization">, private readonly conversations: Pick<ConversationHistoryReader, "readCurrent">, private readonly participants: ConversationComputerRuntimeInputParticipantResolver, private readonly authorization: Pick<AuthorizationAuthority, "admitPrincipal">, private readonly clock: ConversationComputerRuntimeInputClock) {}

	/** Performs exactly one authorization and one atomic KurrentDB append; stale conditions fail closed. */
	public async request(command: ConversationComputerRuntimeInputElicitationCommand): Promise<ConversationComputerRuntimeInputElicitationResult>
	{
		_Validate(command);
		const now = this.clock.now();
		const computer = await this.computers.loadActiveExecutionForRuntime({ siloId: command.siloId, computerId: command.computerId, conversationId: command.conversationId, profileRevisionId: command.profileRevisionId, nowEpochMilliseconds: now.getTime() });
		const identity = await this.identities.loadActiveAuthorization({ siloId: command.siloId, agentIdentityId: computer.computer.agentIdentityId });
		const conversation = await this.conversations.readCurrent({ siloId: command.siloId, conversationId: command.conversationId });
		const participant = await this.participants.resolve({ siloId: command.siloId, conversationId: command.conversationId, computerId: computer.computer.id, agentIdentityId: identity.identity.id });
		if (!_Id(participant.participantId))
			throw new Error("Conversation computer runtime input could not resolve an active participant");
		const admission = await this.authorization.admitPrincipal({ siloId: command.siloId, principalId: identity.principalId, actorKind: identity.actorKind, actorId: identity.actorId, resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: command.conversationId }, action: ProductAuthorizationActions.Use, argumentsDigest: ___DigestCanonicalJson(_Args(command, computer.execution.id, computer.lease.generation, participant.participantId)), nowEpochMs: now.getTime() });
		if (admission.outcome !== AuthorizationDecisionOutcomes.Allow || admission.evidence === null)
			throw new Error("Conversation computer runtime input was denied by current authorization");
		const entry = _Entry(command, computer, conversation.expectedRevision, participant.participantId, admission.evidence.decisionEvidenceId, now);
		if (!___ConversationEntrySchema.safeParse(entry).success)
			throw new Error("Conversation computer runtime input could not stamp a valid participant entry");
		const receipts = await this.history.appendAtomic({ expectedHeads: [{ streamName: computer.streamName, revision: computer.revision }, { streamName: conversation.streamName, revision: conversation.expectedRevision }, ...identity.expectedIdentityHeads], appends: [{ streamName: conversation.streamName, expectedRevision: conversation.expectedRevision, events: [{ id: entry.id, type: "opencrane.conversation-entry.v1", data: { entry }, metadata: { siloId: command.siloId, conversationId: command.conversationId, causationId: command.causationId, correlationId: command.correlationId, idempotencyKey: command.requestId } }] }] });
		const receipt = receipts.find(candidate => candidate.streamName === conversation.streamName);
		if (receipt === undefined)
			throw new Error("Conversation computer runtime input atomic append omitted its conversation receipt");
		return { receipt };
	}
}

function _Entry(command: ConversationComputerRuntimeInputElicitationCommand, computer: Awaited<ReturnType<ConversationComputerHistory["loadActiveExecutionForRuntime"]>>, conversationRevision: HistoryExpectedRevisions.NoStream | bigint, participantId: string, decisionEvidenceId: string, now: Date): ElicitationRequestEntry
{
	return { schemaVersion: 1, id: command.requestId, conversationId: command.conversationId, position: conversationRevision === HistoryExpectedRevisions.NoStream ? "0" : (conversationRevision + 1n).toString(), author: { kind: "system", systemId: "opencrane", name: "OpenCrane" }, provenance: "service-attested", visibility: { audience: "participant_subset", participantIds: [participantId] }, causationId: command.causationId, correlationId: command.correlationId, idempotencyKey: command.requestId, occurredAt: now.toISOString(), attestation: { serviceId: "opencrane", receiptId: command.requestId, domainStream: computer.streamName, domainRevision: computer.revision.toString(), decisionEvidenceId }, kind: ConversationEntryKinds.Elicitation, elicitationId: command.elicitationId, computerId: computer.computer.id, computerExecutionId: computer.execution.id, leaseGeneration: computer.lease.generation, elicitationKind: ConversationElicitationEntryKinds.RuntimeInput, state: ConversationElicitationEntryStates.Requested, addressedParticipantId: participantId, requestPayloadRef: command.requestPayloadRef, requestPayloadDigest: command.requestPayloadDigest, expiresAt: new Date(now.getTime() + _RUNTIME_INPUT_TTL_MILLISECONDS).toISOString() };
}

function _Args(command: ConversationComputerRuntimeInputElicitationCommand, executionId: string, leaseGeneration: number, participantId: string): JsonValue { return { action: "runtime_input", computerId: command.computerId, conversationId: command.conversationId, executionId, leaseGeneration, elicitationId: command.elicitationId, participantId, requestPayloadDigest: command.requestPayloadDigest }; }
function _Validate(command: ConversationComputerRuntimeInputElicitationCommand): void { for (const value of [command.siloId, command.computerId, command.conversationId, command.profileRevisionId, command.requestId, command.elicitationId, command.causationId, command.correlationId]) { if (!_Id(value)) { throw new Error("Conversation computer runtime input requires server-provided coordinates"); } } if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(command.requestId) || !/^payload:\/\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(command.requestPayloadRef) || !/^sha256:[a-f0-9]{64}$/u.test(command.requestPayloadDigest)) { throw new Error("Conversation computer runtime input requires valid request coordinates"); } }
function _Id(value: string): boolean { return value.trim().length > 0 && value === value.trim(); }
