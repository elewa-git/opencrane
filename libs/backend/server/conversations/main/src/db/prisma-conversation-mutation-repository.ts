import { AgentServiceKind, AgentServiceState, ConversationLifecycle, ConversationMessageRole, ConversationMessageState, ConversationMode, OrgMemberStatus, PersonaRevisionState, Prisma } from "@prisma/client";

import type { AgentThreadOrigin } from "@opencrane/backend/conversations/agent-threads";
import { __DecideConversationCommand, ConversationCommandActions, ConversationCommandDenialReasons, ConversationCommandKinds, ConversationLifecycles, ConversationModes, MessageSources } from "@opencrane/models/conversations";

import { AgentThreadReadDenialReasons, ConversationAuthorityOutcomes, ConversationWriteDenialReasons, type ConversationWriteDenial, type CreateConversationResult, type MarkAgentThreadReadResult, type MutateConversationResult } from "../types/conversation-authority-result.types";
import type { ConversationCaller } from "../types/conversation-caller.types";
import type { CreateConversationRequest, SubmitConversationMessageRequest } from "../types/conversation-request.types";
import type { ConversationDetail } from "../types/conversation-view.types";
import type { ConversationMutationRepository } from "./prisma-conversation-mutation-repository.types";
import type { ConversationAttachmentAdmissionPort } from "../conversation-message-admission.types";
import { PrismaConversationQueryRepository } from "./prisma-conversation-query-repository";

/** Exhaustive adapter mapping from model-owned creation modes to Prisma's generated enum. */
const _PERSISTED_MODE_BY_MODE: Readonly<Record<ConversationModes, ConversationMode>> = {
	[ConversationModes.AgentSession]: ConversationMode.AgentSession,
	[ConversationModes.Direct]: ConversationMode.Direct,
	[ConversationModes.Group]: ConversationMode.Group,
};

/**
 * Writes conversations, participants, and participant messages inside a transaction someone else
 * opened.
 *
 * This class never starts, commits, or rolls back a transaction. It is constructed with the
 * `Prisma.TransactionClient` handed to a `$transaction` callback, and the owners of that callback
 * are {@link PrismaConversationUnitOfWork} (`_mutate`, Serializable),
 * `PrismaConversationMessageAdmissionUnitOfWork` (`_mutate`), and `_createMutationRepository` in
 * prisma-self-conversations.router.ts, which binds it to the run-admission transaction. Failing a
 * write here therefore means throwing or returning a denial and letting the caller's transaction
 * decide; see `_requireWrittenConversation`, which throws precisely to force a rollback.
 *
 * Every method re-proves authority against the write snapshot instead of trusting what a read
 * outside the transaction saw: current organisation membership, current participant access, and the
 * conversation's mode and lifecycle. That is what stops a user who was removed from the silo, or
 * from the conversation, between the request arriving and the write landing.
 *
 * Called by: the three transaction owners above. Only these paths may hold it — the Prisma
 * boundary checker pins the class and its path in docs/agents/prisma-boundary-policy.json.
 *
 * @see ConversationMutationRepository for the port this implements.
 */
export class PrismaConversationMutationRepository implements ConversationMutationRepository
{
	private readonly transaction: Prisma.TransactionClient;
	private readonly query: PrismaConversationQueryRepository;

	/** Creates the writer and its query collaborator over the same transaction snapshot. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
		this.query = new PrismaConversationQueryRepository(this.transaction);
	}

	/**
	 * Creates one conversation, in the mode the request asked for, with its full participant set.
	 *
	 * The caller is always a participant and is added by this method, so the request lists only the
	 * other people. The mode is fixed here forever — no later call changes it — which is why the
	 * whole participant and Agent check happens before the first row is written.
	 *
	 * @param caller - Session-derived silo and subject; never taken from the request body.
	 * @param conversationId - Identifier the unit of work generated for this attempt.
	 * @param request - Mode plus the opaque references the creation directory issued.
	 * @returns `Created` with the projected conversation, or `Denied`. A denial is always
	 *   `AgentServiceUnavailable` for an Agent session and `ParticipantUnavailable` otherwise, no
	 *   matter which check failed: both map to 404 in `_STATUS_BY_DENIAL`, so a client cannot use
	 *   creation to test whether a reference, a user, or an Agent exists.
	 * @throws Error when the conversation it just wrote cannot be read back, which rolls the
	 *   serializable transaction back rather than returning a half-built conversation.
	 * @see PrismaConversationMutationRepository._creationAuthority for the checks behind a denial.
	 */
	async create(caller: ConversationCaller, conversationId: string, request: CreateConversationRequest): Promise<CreateConversationResult>
	{
		// 1. Turn the opaque references into internal subjects, and refuse the write if any of them
		// no longer resolves. The request never carries a login subject, so without this step there
		// is nothing to put in a participant row.
		const authority = await this._creationAuthority(caller, request);
		if (authority === null) return { outcome: ConversationAuthorityOutcomes.Denied, reason: request.mode === ConversationModes.AgentSession ? ConversationWriteDenialReasons.AgentServiceUnavailable : ConversationWriteDenialReasons.ParticipantUnavailable };

		// 2. Write the conversation and its participants in the caller's transaction. Both rows must
		// land together — a conversation with no participants would be unreadable by anyone, since
		// every read filters on a participant row.
		await this.transaction.conversation.create({ data: { id: conversationId, siloId: caller.siloId, mode: _prismaMode(request.mode), agentServiceId: authority.agentServiceId } });
		for (const userId of authority.participantUserIds) await this.transaction.conversationParticipant.create({ data: { conversationId, userId } });
		const conversation = _requireWrittenConversation(await this.query.open(caller, conversationId));
		return { outcome: ConversationAuthorityOutcomes.Created, conversation };
	}

	/**
	 * Translates the opaque references a client sent back into the subjects and Agent identifier
	 * that participant rows need, and refuses the write if anything about them has changed.
	 *
	 * Creation used to accept OIDC subjects straight from the request body; it now accepts only the
	 * references the directory issued, and those are OrgMembership row identifiers. Re-resolving them
	 * here, inside the write transaction, is what keeps a reference from outliving the membership it
	 * stands for: a directory response the browser fetched minutes ago may name someone who has since
	 * been removed from the silo.
	 *
	 * @returns The internal subjects to write as participants plus the Agent service to bind, or
	 *   null when any check failed. It is deliberately one null for every reason — an unknown
	 *   reference, a removed member, a reference from another silo, a duplicate, the caller's own
	 *   reference, no approved persona, no active personal Agent, more than one matching Agent, or an
	 *   Agent reference that is not the caller's. {@link PrismaConversationMutationRepository.create}
	 *   turns it into a 404-mapped denial, so none of these can be told apart from outside.
	 */
	private async _creationAuthority(caller: ConversationCaller, request: CreateConversationRequest): Promise<{ readonly participantUserIds: readonly string[]; readonly agentServiceId: string | null } | null>
	{
		// 1. The caller's own membership must still be active in this silo. It is also read for its
		// row id, which is the caller's own participant reference and is needed by step 2.
		const callerMembership = await this.transaction.orgMembership.findFirst({ where: { clusterTenant: caller.siloId, subject: caller.subjectId, status: OrgMemberStatus.Active }, select: { id: true } });
		if (callerMembership === null) return null;
		if (request.mode !== ConversationModes.AgentSession)
		{
			// 2. Direct and group requests list the OTHER people only, and this method adds the caller
			// below. So a repeated reference, or the caller's own reference, is rejected rather than
			// deduplicated: accepting either would make a "direct" conversation of one person, or a
			// group whose member count does not match what the client asked for. The size limits (one
			// other for direct, up to 99 for group) are already enforced by
			// `_ConversationCreationRequestSchema` in validators/conversation-creation.validator.ts.
			const uniqueReferences = [...new Set(request.participantRefs)];
			if (uniqueReferences.length !== request.participantRefs.length || uniqueReferences.includes(callerMembership.id)) return null;

			// 3. Every reference must resolve to an active membership in the caller's own silo. The
			// count comparison is the whole check: a reference that is unknown, revoked, or belongs to
			// another silo simply does not come back, and one missing row fails the entire creation.
			const memberships = await this.transaction.orgMembership.findMany({ where: { id: { in: uniqueReferences }, clusterTenant: caller.siloId, status: OrgMemberStatus.Active }, select: { subject: true }, orderBy: { id: "asc" } });
			if (memberships.length !== uniqueReferences.length) return null;
			const participantUserIds = [caller.subjectId, ...memberships.map(function _Subject(row): string { return row.subject; })];
			return { participantUserIds, agentServiceId: null };
		}

		// 4. An Agent session has one human participant, the caller, and one Agent. The Agent is not
		// taken from the request: it is looked up from the persona revision the approval flow made
		// active on the caller's profile, and the request's reference only has to agree with what was
		// found. That is why naming someone else's AgentService cannot work, and why two matching
		// services fail closed instead of picking one — the same rule the directory reports as
		// `PersonalAgentDirectoryStatuses.Ambiguous`.
		const profile = await this.transaction.personaProfile.findUnique({ where: { siloId_userId: { siloId: caller.siloId, userId: caller.subjectId } }, select: { activeRevisionId: true } });
		if (profile?.activeRevisionId === null || profile?.activeRevisionId === undefined) return null;
		const services = await this.transaction.agentService.findMany({ where: { siloId: caller.siloId, kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: { not: null }, activeRevision: { is: { personaRevisionId: profile.activeRevisionId } } }, select: { id: true }, orderBy: { id: "asc" }, take: 2 });
		if (services.length !== 1 || services[0]?.id !== request.personalAgentRef) return null;
		return { participantUserIds: [caller.subjectId], agentServiceId: services[0].id };
	}

	/**
	 * Hides or unhides the conversation for this one participant.
	 *
	 * Archiving is per participant, not per conversation: it writes `archivedAt` on the caller's own
	 * participant row, so nobody else's list changes and the conversation stays open. That is why it is
	 * not routed through the command decision the way `close` is.
	 *
	 * @param archived - True to archive, false to bring it back.
	 * @returns `Changed` with the projected conversation, or `Denied` with `ConversationUnavailable` —
	 *   used for a revoked membership, a conversation the caller cannot see, and a participant whose
	 *   access has already ended, so none of the three can be told apart.
	 * @throws Error when the conversation cannot be read back after the update, rolling the
	 *   transaction back.
	 */
	async setArchived(caller: ConversationCaller, conversationId: string, archived: boolean): Promise<MutateConversationResult>
	{
		// 1. Revalidate active silo membership inside the serializable archive transaction.
		if (!await this.query.hasActiveCallerMembership(caller)) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.ConversationUnavailable };

		// 2. Change only the continuing participant's local visibility coordinate.
		const changed = await this.transaction.conversationParticipant.updateMany({ where: { conversationId, userId: caller.subjectId, accessEndedPosition: null, conversation: { siloId: caller.siloId } }, data: { archivedAt: archived ? new Date() : null } });
		if (changed.count !== 1) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.ConversationUnavailable };

		// 3. Project the response from the same membership-authorised write snapshot.
		const conversation = _requireWrittenConversation(await this.query.open(caller, conversationId));
		return { outcome: ConversationAuthorityOutcomes.Changed, conversation };
	}

	/**
	 * Closes the conversation for everyone, permanently.
	 *
	 * There is no reopen, so the checks all happen inside the write transaction: an agent run that
	 * starts while the request is in flight still blocks the close instead of being left running in a
	 * conversation nobody can post to. The `updateMany` is conditional on the lifecycle still being
	 * `Open`, which makes a second close a denial rather than a second write.
	 *
	 * @returns `Changed` with the closed conversation, or `Denied`: `ActiveRun` when a run is still in
	 *   progress, `ConversationClosed` or `CommandNotSupported` from the shared command decision, and
	 *   `ConversationUnavailable` when the caller may not see it or lost the race to close it.
	 * @throws Error when the closed conversation cannot be read back, rolling the transaction back.
	 * @see __DecideConversationCommand for the mode-and-lifecycle rule every write shares.
	 */
	async close(caller: ConversationCaller, conversationId: string): Promise<MutateConversationResult>
	{
		// 1. Load membership, participant, lifecycle, mode, binding, and run facts from this write snapshot.
		const context = await this.query.loadCommandContext(caller, conversationId);
		if (context === null) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.ConversationUnavailable };

		// 2. Route closure through the same exhaustive State-by-Command decision as every other write.
		const decision = __DecideConversationCommand({ ...context, command: { kind: ConversationCommandKinds.Close } });
		if (!decision.allowed) return { outcome: ConversationAuthorityOutcomes.Denied, reason: _writeDenialForDecision(decision.reason) };
		if (decision.action !== ConversationCommandActions.CloseConversation) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.CommandNotSupported };
		if (context.activeRunId !== null) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.ActiveRun };

		// 3. Apply the monotonic transition and project its result before this serializable transaction commits.
		const update = await this.transaction.conversation.updateMany({ where: { id: conversationId, siloId: caller.siloId, lifecycle: ConversationLifecycle.Open }, data: { lifecycle: ConversationLifecycle.Closed, closedAt: new Date() } });
		if (update.count !== 1) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.ConversationUnavailable };
		const conversation = _requireWrittenConversation(await this.query.open(caller, conversationId));
		return { outcome: ConversationAuthorityOutcomes.Changed, conversation };
	}

	/**
	 * Moves this participant's "read up to here" marker in an Agent thread forward.
	 *
	 * The marker only ever moves forward — the update requires `readThroughPosition` to be lower than
	 * the one being written, and a position at or behind the marker is reported as `Idempotent` instead
	 * of an error, so a client resending an older position cannot make unread counts reappear. A
	 * position ahead of the last timeline entry is refused rather than stored, because it would mark
	 * messages read that do not exist yet. Access to the thread is proven twice, on the parent and on
	 * the child conversation: losing access to the parent must also end access to the thread it spawned.
	 *
	 * @param observedPosition - The child timeline position the participant has actually seen.
	 * @returns `Changed` or `Idempotent` with the resulting marker, or `Denied`:
	 *   `ObservedPositionUnavailable` (409 at the route) when the position is ahead of the timeline, and
	 *   `ConversationUnavailable` (404) for every access failure.
	 */
	async markAgentThreadRead(caller: ConversationCaller, parentConversationId: string, childConversationId: string, observedPosition: bigint): Promise<MarkAgentThreadReadResult>
	{
		if (!await this.query.hasActiveCallerMembership(caller)) return { outcome: ConversationAuthorityOutcomes.Denied, reason: AgentThreadReadDenialReasons.ConversationUnavailable };
		const thread = await this.transaction.conversationAgentThread.findFirst({
			where: { parentConversationId, childConversationId, siloId: caller.siloId, parentConversation: { participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } }, childConversation: { participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } } },
			select: { childConversation: { select: { participants: { where: { userId: caller.subjectId, accessEndedPosition: null }, select: { readThroughPosition: true } } } } },
		});
		const participant = thread?.childConversation.participants[0];
		if (participant === undefined) return { outcome: ConversationAuthorityOutcomes.Denied, reason: AgentThreadReadDenialReasons.ConversationUnavailable };
		const latest = await this.transaction.conversationTimelineEntry.findFirst({ where: { conversationId: childConversationId }, orderBy: { position: "desc" }, select: { position: true } });
		const latestPosition = latest?.position ?? 0n;
		if (observedPosition > latestPosition) return { outcome: ConversationAuthorityOutcomes.Denied, reason: AgentThreadReadDenialReasons.ObservedPositionUnavailable };
		if (observedPosition <= participant.readThroughPosition) return { outcome: ConversationAuthorityOutcomes.Idempotent, readThroughPosition: participant.readThroughPosition.toString(10) };
		const changed = await this.transaction.conversationParticipant.updateMany({ where: { conversationId: childConversationId, userId: caller.subjectId, accessEndedPosition: null, readThroughPosition: { lt: observedPosition }, conversation: { siloId: caller.siloId, originAgentThread: { is: { parentConversationId, parentConversation: { participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } } } } } }, data: { readThroughPosition: observedPosition } });
		if (changed.count !== 1) return { outcome: ConversationAuthorityOutcomes.Denied, reason: AgentThreadReadDenialReasons.ConversationUnavailable };
		return { outcome: ConversationAuthorityOutcomes.Changed, readThroughPosition: observedPosition.toString(10) };
	}

	/**
	 * Writes a message that starts no agent run — the direct and group case.
	 *
	 * The mode decision is re-run here rather than trusted from the route: a conversation can be closed
	 * between the request arriving and this write, and an Agent-session conversation must never take
	 * this path, since its messages have to be admitted together with a run.
	 *
	 * @param attachments - Binds already-uploaded assets to the new message in the same transaction, so
	 *   a message never references an asset that is not attached.
	 * @returns `Accepted`, or `Denied` with `ConversationClosed` when the conversation closed and
	 *   `CommandNotSupported` when this mode does not admit a plain message.
	 */
	async admitOrdinaryMessage(caller: ConversationCaller, conversationId: string, messageId: string, request: SubmitConversationMessageRequest, attachments: ConversationAttachmentAdmissionPort): Promise<{ readonly outcome: ConversationAuthorityOutcomes.Accepted } | { readonly outcome: ConversationAuthorityOutcomes.Denied; readonly reason: ConversationWriteDenial }>
	{
		const context = await this.query.loadCommandContext(caller, conversationId);
		if (context === null) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.ConversationUnavailable };
		const decision = __DecideConversationCommand({ ...context, command: { kind: ConversationCommandKinds.SubmitMessage } });
		if (!decision.allowed || decision.action !== ConversationCommandActions.AdmitOrdinaryMessage) return { outcome: ConversationAuthorityOutcomes.Denied, reason: context.lifecycle === ConversationLifecycles.Closed ? ConversationWriteDenialReasons.ConversationClosed : ConversationWriteDenialReasons.CommandNotSupported };
		await this.transaction.conversationMessage.create({ data: _messageData(messageId, conversationId, caller.subjectId, request, null) });
		await attachments.bindReadyAssets(caller, conversationId, messageId, request.blocks);
		return { outcome: ConversationAuthorityOutcomes.Accepted };
	}

	/**
	 * Writes the user's message inside the transaction that is already starting an agent run.
	 *
	 * Unlike the other methods here it throws instead of returning a denial, because by this point the
	 * run is staged in the same transaction: the only correct way to refuse is to make the whole
	 * transaction roll back, taking the run with it. A returned denial would leave a run with no message
	 * that asked for it.
	 *
	 * @param runId - The run staged in this transaction; stored on the message so the two are linked.
	 * @throws Error when membership, participant access, or the mode decision no longer allows the
	 *   message — which discards the staged run as well.
	 */
	async persistAgentMessage(caller: ConversationCaller, conversationId: string, messageId: string, runId: string, request: SubmitConversationMessageRequest, attachments: ConversationAttachmentAdmissionPort): Promise<void>
	{
		// 1. Revalidate current silo membership and participant access inside run admission's final transaction.
		const context = await this.query.loadCommandContext(caller, conversationId);
		if (context === null) throw new Error("Conversation authority unavailable");

		// 2. Re-dispatch persisted mode and lifecycle through the exhaustive strategy after the run is staged.
		const decision = __DecideConversationCommand({ ...context, command: { kind: ConversationCommandKinds.SubmitMessage } });
		if (!decision.allowed || decision.action !== ConversationCommandActions.AdmitAgentRun) throw new Error("Conversation command unavailable");

		// 3. Persist the message only after every caller and immutable-mode fence remains valid.
		await this.transaction.conversationMessage.create({ data: _messageData(messageId, conversationId, caller.subjectId, request, runId) });
		await attachments.bindReadyAssets(caller, conversationId, messageId, request.blocks);
	}

	/**
	 * Writes the message that asks an Agent something in a group, plus the child conversation the Agent
	 * will answer in.
	 *
	 * This runs before the first run is staged, because run admission needs the child conversation to
	 * exist to attach the run to. Only a group conversation with at least two current participants can
	 * spawn a thread — the caller among them — and the child mirrors the parent's participant list at
	 * this moment, which is what later reads compare against. Every participant's organisation
	 * membership is re-counted here, so one removed member stops the thread rather than being silently
	 * dropped from it.
	 *
	 * @returns The persona profile and revision behind the Agent, which the caller records on the
	 *   thread's origin so the answer stays attributable to the persona that produced it.
	 * @throws Error for a missing agent target, a parent that is not an open group, an Agent service or
	 *   approved persona that is unavailable, or a participant set that no longer qualifies. Each throw
	 *   rolls back the message and child conversation together.
	 */
	async prepareAgentThread(caller: ConversationCaller, parentConversationId: string, parentMessageId: string, childConversationId: string, request: SubmitConversationMessageRequest, attachments: ConversationAttachmentAdmissionPort): Promise<{ readonly personaProfileId: string; readonly personaRevisionId: string }>
	{
		if (request.agentTarget === undefined) throw new Error("Agent target unavailable");
		const context = await this.query.loadCommandContext(caller, parentConversationId);
		if (context?.mode !== ConversationModes.Group || context.lifecycle !== ConversationLifecycles.Open) throw new Error("Agent-thread parent unavailable");
		const service = await this.transaction.agentService.findFirst({ where: { id: request.agentTarget.agentServiceId, siloId: caller.siloId, kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: { not: null } }, select: { id: true } });
		const persona = await this.transaction.personaProfile.findFirst({ where: { siloId: caller.siloId, userId: caller.subjectId, activeRevision: { is: { state: PersonaRevisionState.Approved } } }, select: { id: true, activeRevisionId: true } });
		if (service === null || persona === null || persona.activeRevisionId === null) throw new Error("Agent-thread identity unavailable");
		const participants = await this.transaction.conversationParticipant.findMany({ where: { conversationId: parentConversationId, accessEndedPosition: null }, select: { userId: true }, orderBy: { userId: "asc" } });
		if (participants.length < 2 || !participants.some(function _Caller(row): boolean { return row.userId === caller.subjectId; })) throw new Error("Agent-thread participants unavailable");
		const userIds = participants.map(function _Id(row): string { return row.userId; });
		if (await this.transaction.orgMembership.count({ where: { clusterTenant: caller.siloId, subject: { in: userIds }, status: OrgMemberStatus.Active } }) !== userIds.length) throw new Error("Agent-thread participants unavailable");
		await this.transaction.conversationMessage.create({ data: _messageData(parentMessageId, parentConversationId, caller.subjectId, request, null) });
		await attachments.bindReadyAssets(caller, parentConversationId, parentMessageId, request.blocks);
		await this.transaction.conversation.create({ data: { id: childConversationId, siloId: caller.siloId, mode: ConversationMode.AgentSession, agentServiceId: service.id } });
		for (const userId of userIds) await this.transaction.conversationParticipant.create({ data: { conversationId: childConversationId, userId } });
		return { personaProfileId: persona.id, personaRevisionId: persona.activeRevisionId };
	}

	/**
	 * Finishes an Agent thread: writes the copy of the question inside the child conversation and the
	 * origin row that ties child, parent, and first run together.
	 *
	 * It runs after the first run is staged because the origin row records `firstRunId`, and the assets
	 * are mirrored rather than moved so the question keeps its attachments in both conversations.
	 *
	 * @param origin - Parent, child, root, message, initiator, Agent, persona revision, and first run —
	 *   all fixed at creation and never updated afterwards.
	 * @throws Error from the database when any of those references does not hold, rolling back the whole
	 *   thread rather than leaving a child conversation with no origin.
	 */
	async persistAgentThread(caller: ConversationCaller, origin: AgentThreadOrigin, personaProfileId: string, childMessageId: string, parentRequest: SubmitConversationMessageRequest, childRequest: SubmitConversationMessageRequest, attachments: ConversationAttachmentAdmissionPort): Promise<void>
	{
		await this.transaction.conversationMessage.create({ data: _messageData(childMessageId, origin.childConversationId, caller.subjectId, childRequest, origin.firstRunId) });
		await attachments.mirrorReadyAssets(caller, origin.parentConversationId, origin.childConversationId, childMessageId, parentRequest.blocks, childRequest.blocks);
		await this.transaction.conversationAgentThread.create({ data: { childConversationId: origin.childConversationId, parentConversationId: origin.parentConversationId, rootConversationId: origin.rootConversationId, siloId: caller.siloId, parentMessageId: origin.parentMessageId, initiatorUserId: origin.initiatorUserId, agentServiceId: origin.agentServiceId, personaProfileId, personaRevisionId: origin.personaRevisionId, firstRunId: origin.firstRunId } });
	}
}

/**
 * Builds the single row shape this package is allowed to write for participant input.
 *
 * Every field is fixed rather than taken from the request: role `User`, state `Completed`, source
 * `UserInput`, and a `completedAt` set now. The reviewed baseline's
 * `conversation_messages_provenance_check` only accepts `user_input` rows that carry a `user_id` and
 * the `user` role, so a message written any other way would be rejected by the database.
 */
function _messageData(messageId: string, conversationId: string, userId: string, request: SubmitConversationMessageRequest, runId: string | null): Prisma.ConversationMessageUncheckedCreateInput
{
	return { id: messageId, conversationId, runId, userId, idempotencyKey: request.idempotencyKey, role: ConversationMessageRole.User, state: ConversationMessageState.Completed, source: MessageSources.UserInput, blocks: request.blocks as unknown as Prisma.InputJsonValue, completedAt: new Date() };
}

/** Maps dependency-light mode vocabulary to Prisma's generated enum. */
function _prismaMode(mode: CreateConversationRequest["mode"]): ConversationMode
{
	return _PERSISTED_MODE_BY_MODE[mode];
}

/** Maps the pure strategy's denial into the stable participant API vocabulary. */
function _writeDenialForDecision(reason: ConversationCommandDenialReasons): ConversationWriteDenial
{
	return reason === ConversationCommandDenialReasons.ConversationClosed ? ConversationWriteDenialReasons.ConversationClosed : ConversationWriteDenialReasons.CommandNotSupported;
}

/** Forces the serializable transaction to roll back when an authorised write cannot be projected. */
function _requireWrittenConversation(conversation: ConversationDetail | null): ConversationDetail
{
	if (conversation === null) throw new Error("Written conversation projection unavailable");
	return conversation;
}
