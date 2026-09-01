import { ___ConversationEntrySchema, ConversationElicitationEntryStates, ConversationEntryKinds, type ConversationEntry, type ElicitationRequestEntry, type ElicitationResolutionEntry } from "@opencrane/contracts";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { HistoryExpectedRevisions, type HistoryAppendReceipt, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationHistoryReader } from "../conversation-history-reader";
import type { CurrentConversationHistory } from "../conversation-history-reader.types";
import { ConversationComputerHistory } from "./conversation-computer-history";
import type { ConversationComputerElicitationPayloadAuthority, ConversationComputerElicitationResolutionClock, ConversationComputerElicitationResolutionCommand, ConversationComputerElicitationResolutionParticipantResolver, ConversationComputerElicitationResolutionResult, PreparedConversationComputerElicitationResponse } from "./conversation-computer-elicitation-resolution.types";

/**
 * Resolves an addressed participant's elicitation request into one service-attested terminal entry.
 *
 * Participant resolution starts at a browser session, but the browser must not choose the request
 * owner, computer execution, lease, identity, or history revision. This authority replays the
 * request, derives and authorizes its participant, and appends under the current computer,
 * conversation, and AgentIdentity heads. An exact response-lost retry returns its saved receipt
 * after current participant and authorization checks; another resolution or changed answer fails
 * closed. It neither resumes a legacy workflow nor falls back to the Prisma elicitation authority.
 *
 * Called by: no production composition yet; the replacement participant interrupt transport will
 * compose it when it is ready.
 * @see ConversationComputerRuntimeInputElicitationAuthority for the authority that records the request.
 */
export class ConversationComputerElicitationResolutionAuthority
{
	public constructor(
		private readonly history: Pick<HistoryStore, "appendAtomic">,
		private readonly computers: Pick<ConversationComputerHistory, "loadActiveExecutionForRuntime">,
		private readonly identities: Pick<AgentIdentityHistory, "loadActiveAuthorization">,
		private readonly conversations: Pick<ConversationHistoryReader, "readCurrent">,
		private readonly participants: ConversationComputerElicitationResolutionParticipantResolver,
		private readonly payloads: ConversationComputerElicitationPayloadAuthority,
		private readonly authorization: Pick<AuthorizationAuthority, "admitPrincipal">,
		private readonly clock: ConversationComputerElicitationResolutionClock,
	)
	{
	}

	/**
	 * Resolves one open request or returns the saved receipt for an exact participant retry.
	 *
	 * A new answer records `answered` with protected response coordinates; an explicit null records
	 * `declined`; a request past its server deadline records `expired` without accepting the late
	 * answer. A retry must still resolve to the addressed participant and pass `Conversation/Use`;
	 * it returns the original receipt only when its identifier, terminal state, and answer digest
	 * match the entry already in history.
	 *
	 * Called by: the future participant interrupt transport, which has no production composition yet.
	 * @param command - The authenticated caller and browser-safe request, retry, and response facts.
	 * @returns The terminal state and its receipt; callers treat every returned state as final.
	 * @throws {Error} Rejects malformed input, a non-addressed or unauthorized caller, a missing or
	 * closed request, changed retry facts, retired runtime ownership, invalid payload coordinates, or
	 * a history-head conflict.
	 */
	public async resolve(command: ConversationComputerElicitationResolutionCommand): Promise<ConversationComputerElicitationResolutionResult>
	{
		_Validate(command);
		const now = this.clock.now();

		// 1. Replay the current transcript so the request and any earlier terminal winner are authoritative.
		const conversation = await this.conversations.readCurrent({ siloId: command.caller.siloId, conversationId: command.conversationId });
		const request = _Request(conversation, command);

		// 2. Derive and authorize the current participant before exposing request-schema validation work.
		const participant = await this.participants.resolve({ caller: command.caller, conversationId: command.conversationId });
		if (participant.participantId !== request.addressedParticipantId)
			throw new Error("Conversation computer elicitation resolution caller is not the addressed participant");
		const existingResolution = _ExistingResolution(conversation, request);
		const expectedState = _ExpectedState(request, command.response, now, existingResolution, command.resolutionId);
		const admission = await this.authorization.admitPrincipal({
			siloId: command.caller.siloId,
			principalId: command.caller.principalId,
			actorKind: "user",
			actorId: command.caller.actorId,
			resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: command.conversationId },
			action: ProductAuthorizationActions.Use,
			argumentsDigest: ___DigestCanonicalJson(_Arguments(command, request, expectedState)),
			nowEpochMs: now.getTime(),
		});
		if (admission.outcome !== AuthorizationDecisionOutcomes.Allow || admission.evidence === null)
			throw new Error("Conversation computer elicitation resolution was denied by current authorization");
		const preparedResponse = await _PreparedResponse(this.payloads, command, request, participant.participantId, expectedState);

		// 3. Return only an exact durable response-lost winner after the caller has been reauthorized.
		const existingReceipt = _ExistingResolutionReceipt(conversation, existingResolution, command, expectedState, preparedResponse);
		if (existingReceipt !== null)
			return { receipt: existingReceipt, state: _ResultState(expectedState) };

		// 4. Recheck the request's computer and identity heads before writing its terminal event.
		const computer = await this.computers.loadActiveExecutionForRuntime({
			siloId: command.caller.siloId,
			computerId: request.computerId,
			conversationId: command.conversationId,
			profileRevisionId: request.profileRevisionId,
			nowEpochMilliseconds: now.getTime(),
		});
		if (computer.execution.id !== request.computerExecutionId || computer.lease.generation !== request.leaseGeneration)
			throw new Error("Conversation computer elicitation resolution request belongs to a retired execution");
		const identity = await this.identities.loadActiveAuthorization({ siloId: command.caller.siloId, agentIdentityId: computer.computer.agentIdentityId });
		const responseCoordinates = await _ResponseCoordinates(this.payloads, command, request, participant.participantId, preparedResponse);
		const entry = _Entry(command, request, conversation.expectedRevision, expectedState, responseCoordinates, admission.evidence.decisionEvidenceId, computer.streamName, computer.revision, now);
		if (!___ConversationEntrySchema.safeParse(entry).success)
			throw new Error("Conversation computer elicitation resolution could not stamp a valid terminal entry");

		const receipts = await this.history.appendAtomic({
			expectedHeads: [{ streamName: computer.streamName, revision: computer.revision }, { streamName: conversation.streamName, revision: conversation.expectedRevision }, ...identity.expectedIdentityHeads],
			appends: [{ streamName: conversation.streamName, expectedRevision: conversation.expectedRevision, events: [{ id: entry.id, type: "opencrane.conversation-entry.v1", data: { entry }, metadata: { siloId: command.caller.siloId, conversationId: command.conversationId, causationId: request.id, correlationId: request.correlationId, idempotencyKey: command.resolutionId } }] }],
		});
		const receipt = receipts.find(function _ConversationReceipt(candidate) { return candidate.streamName === conversation.streamName; });
		if (receipt === undefined)
			throw new Error("Conversation computer elicitation resolution atomic append omitted its conversation receipt");
		return { receipt, state: _ResultState(expectedState) };
	}
}

/** Locates the one durable open request that an authenticated participant may attempt to resolve. */
function _Request(conversation: CurrentConversationHistory, command: ConversationComputerElicitationResolutionCommand): ElicitationRequestEntry
{
	const request = conversation.entries.find(function _RequestEntry(entry) { return entry.id === command.requestEntryId; });
	if (request === undefined || request.kind !== ConversationEntryKinds.Elicitation || request.state !== ConversationElicitationEntryStates.Requested)
		throw new Error("Conversation computer elicitation resolution request is missing or not open");
	return request;
}

/** Selects the only terminal outcome a participant command may create at the server's current time. */
function _ExpectedState(request: ElicitationRequestEntry, response: JsonValue | null, now: Date, existing: ElicitationResolutionEntry | null, resolutionId: string): ConversationElicitationEntryStates.Answered | ConversationElicitationEntryStates.Declined | ConversationElicitationEntryStates.Expired
{
	if (existing !== null && existing.idempotencyKey === resolutionId)
	{
		if (existing.state === ConversationElicitationEntryStates.Cancelled)
			throw new Error("Conversation computer elicitation resolution idempotency key belongs to a cancelled request");
		if (existing.state === ConversationElicitationEntryStates.Expired)
			return ConversationElicitationEntryStates.Expired;
		const submittedState = response === null ? ConversationElicitationEntryStates.Declined : ConversationElicitationEntryStates.Answered;
		if (existing.state !== submittedState)
			throw new Error("Conversation computer elicitation resolution idempotency key already owns different terminal facts");
		return existing.state;
	}
	if (now.getTime() >= new Date(request.expiresAt).getTime())
		return ConversationElicitationEntryStates.Expired;
	if (response === null)
		return ConversationElicitationEntryStates.Declined;
	return ConversationElicitationEntryStates.Answered;
}

/** Prepares an answer only when the server may still accept one for the current request. */
async function _PreparedResponse(payloads: ConversationComputerElicitationPayloadAuthority, command: ConversationComputerElicitationResolutionCommand, request: ElicitationRequestEntry, participantId: string, state: ConversationElicitationEntryStates.Answered | ConversationElicitationEntryStates.Declined | ConversationElicitationEntryStates.Expired): Promise<PreparedConversationComputerElicitationResponse | null>
{
	if (state !== ConversationElicitationEntryStates.Answered || command.response === null)
		return null;
	return payloads.prepareResponse({ siloId: command.caller.siloId, conversationId: command.conversationId, participantId, request, response: command.response });
}

/** Finds the one prior terminal winner, rejecting impossible duplicate terminal history. */
function _ExistingResolution(conversation: CurrentConversationHistory, request: ElicitationRequestEntry): ElicitationResolutionEntry | null
{
	const resolutions = conversation.entries.filter(function _ResolutionEntry(entry): entry is ElicitationResolutionEntry
	{
		return _IsResolution(entry) && entry.requestEntryId === request.id;
	});
	if (resolutions.length === 0)
		return null;
	if (resolutions.length !== 1)
		throw new Error("Conversation computer elicitation resolution found multiple terminal entries");
	return resolutions[0];
}

/** Returns a retry receipt only when the same authorized command owns the one terminal winner. */
function _ExistingResolutionReceipt(conversation: CurrentConversationHistory, resolution: ElicitationResolutionEntry | null, command: ConversationComputerElicitationResolutionCommand, expectedState: ConversationElicitationEntryStates.Answered | ConversationElicitationEntryStates.Declined | ConversationElicitationEntryStates.Expired, preparedResponse: PreparedConversationComputerElicitationResponse | null): HistoryAppendReceipt | null
{
	if (resolution === null)
		return null;
	if (resolution.idempotencyKey !== command.resolutionId)
		throw new Error("Conversation computer elicitation request already has a terminal resolution");
	const hasExactAnswer = expectedState !== ConversationElicitationEntryStates.Answered || (preparedResponse !== null && resolution.responsePayloadDigest === preparedResponse.responseDigest);
	if (resolution.state !== expectedState || !hasExactAnswer)
		throw new Error("Conversation computer elicitation resolution idempotency key already owns different terminal facts");
	return { streamName: conversation.streamName, revision: BigInt(resolution.position) };
}

/** Narrows a validated transcript entry to the terminal member of an elicitation lifecycle. */
function _IsResolution(entry: ConversationEntry): entry is ElicitationResolutionEntry
{
	return entry.kind === ConversationEntryKinds.Elicitation && entry.state !== ConversationElicitationEntryStates.Requested;
}

/** Stores a validated answer only after all request, participant, and authorization checks have passed. */
async function _ResponseCoordinates(payloads: ConversationComputerElicitationPayloadAuthority, command: ConversationComputerElicitationResolutionCommand, request: ElicitationRequestEntry, participantId: string, preparedResponse: PreparedConversationComputerElicitationResponse | null): Promise<{ readonly responsePayloadRef: string; readonly responsePayloadDigest: `sha256:${string}` } | null>
{
	if (preparedResponse === null)
		return null;
	const stored = await payloads.storeResponse({ siloId: command.caller.siloId, conversationId: command.conversationId, participantId, request, resolutionId: command.resolutionId, response: preparedResponse });
	if (!_PayloadRef(stored.responsePayloadRef) || stored.responsePayloadDigest !== preparedResponse.responseDigest)
		throw new Error("Conversation computer elicitation payload authority returned invalid response coordinates");
	return stored;
}

/** Stamps the terminal resolution from immutable request ownership and checked server heads. */
function _Entry(command: ConversationComputerElicitationResolutionCommand, request: ElicitationRequestEntry, conversationRevision: HistoryExpectedRevisions.NoStream | bigint, state: ConversationElicitationEntryStates.Answered | ConversationElicitationEntryStates.Declined | ConversationElicitationEntryStates.Expired, response: { readonly responsePayloadRef: string; readonly responsePayloadDigest: `sha256:${string}` } | null, decisionEvidenceId: string, computerStream: string, computerRevision: bigint, now: Date): ElicitationResolutionEntry
{
	const position = conversationRevision === HistoryExpectedRevisions.NoStream ? "0" : (conversationRevision + 1n).toString();
	return {
		schemaVersion: 1,
		id: command.resolutionId,
		conversationId: command.conversationId,
		position,
		author: { kind: "system", systemId: "opencrane", name: "OpenCrane" },
		provenance: "service-attested",
		visibility: { audience: "participant_subset", participantIds: [request.addressedParticipantId] },
		causationId: request.id,
		correlationId: request.correlationId,
		idempotencyKey: command.resolutionId,
		occurredAt: now.toISOString(),
		attestation: { serviceId: "opencrane", receiptId: command.resolutionId, domainStream: computerStream, domainRevision: computerRevision.toString(), decisionEvidenceId },
		kind: ConversationEntryKinds.Elicitation,
		elicitationId: request.elicitationId,
		computerId: request.computerId,
		computerExecutionId: request.computerExecutionId,
		leaseGeneration: request.leaseGeneration,
		elicitationKind: request.elicitationKind,
		state,
		requestEntryId: request.id,
		responsePayloadRef: response?.responsePayloadRef ?? null,
		responsePayloadDigest: response?.responsePayloadDigest ?? null,
	};
}

/** Builds the recorded authorization digest from browser-safe command facts and server-derived request ownership. */
function _Arguments(command: ConversationComputerElicitationResolutionCommand, request: ElicitationRequestEntry, state: ConversationElicitationEntryStates.Answered | ConversationElicitationEntryStates.Declined | ConversationElicitationEntryStates.Expired): JsonValue
{
	return { action: "elicitation_resolution", conversationId: command.conversationId, requestEntryId: request.id, resolutionId: command.resolutionId, state, responseDigest: command.response === null ? null : ___DigestCanonicalJson(command.response) };
}

/** Maps durable enum values to the narrow result vocabulary returned to the transport. */
function _ResultState(state: ConversationElicitationEntryStates.Answered | ConversationElicitationEntryStates.Declined | ConversationElicitationEntryStates.Expired): "answered" | "declined" | "expired"
{
	if (state === ConversationElicitationEntryStates.Answered)
		return "answered";
	if (state === ConversationElicitationEntryStates.Declined)
		return "declined";
	return "expired";
}

/** Rejects malformed caller and idempotency coordinates before any durable authority is read. */
function _Validate(command: ConversationComputerElicitationResolutionCommand): void
{
	const identifiers = [command.caller.siloId, command.caller.principalId, command.caller.actorId, command.conversationId, command.requestEntryId];
	if (identifiers.some(function _InvalidIdentifier(value) { return value.trim().length === 0 || value !== value.trim(); }))
		throw new Error("Conversation computer elicitation resolution requires server-provided caller coordinates");
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(command.resolutionId))
		throw new Error("Conversation computer elicitation resolution requires a UUID resolution identifier");
}

/** Accepts only the opaque protected-payload reference vocabulary used by conversation history. */
function _PayloadRef(value: string): boolean
{
	return /^payload:\/\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}
