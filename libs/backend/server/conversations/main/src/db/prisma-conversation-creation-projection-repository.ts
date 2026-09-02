import { ConversationCreationReservationState, ConversationMode, type Prisma } from "@prisma/client";

import { PrismaChannelTargetParticipantGrantProjectionRepository } from "@opencrane/backend/server/agents/channel-targets";
import { ConversationLifecycleModes, type ConversationCreated } from "@opencrane/contracts";

import type { ConversationCreationProjectionCommand, ConversationCreationProjectionRepository } from "../history-anchored-conversation-creation-authority.types";
import { PrismaConversationProductAuthorizationRepository } from "./conversation-product-authorization";

/** Materializes immutable creation state with the serializable transaction supplied by its UoW. */
export class PrismaConversationCreationProjectionRepository implements ConversationCreationProjectionRepository
{
	/** Holds the transaction that owns directory rows, grants, and the final reservation transition. */
	public constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Applies one history-derived directory projection, accepting only an exact idempotent replay. */
	public async project(command: ConversationCreationProjectionCommand, created: ConversationCreated): Promise<void>
	{
		const reservation = await this.transaction.conversationCreationReservation.findUnique({ where: { id: command.reservationId }, include: { participants: { orderBy: { ordinal: "asc" } } } });
		if (reservation === null || reservation.siloId !== command.siloId || reservation.conversationId !== command.conversationId)
			throw new Error("Conversation creation projection reservation is unavailable");
		if (reservation.state === ConversationCreationReservationState.Projected)
			return;
		if (reservation.state !== ConversationCreationReservationState.HistoryAnchored || reservation.historyRevision !== command.historyRevision)
			throw new Error("Conversation creation projection requires its confirmed revision-zero anchor");
		_AssertAnchor(reservation, created);
		const existing = await this.transaction.conversation.findUnique({ where: { id: command.conversationId } });
		if (existing === null)
			await this.transaction.conversation.create({ data: { id: command.conversationId, siloId: command.siloId, mode: _Mode(created.mode), agentServiceId: reservation.agentServiceId, createdAt: new Date(created.createdAt) } });
		else
			_AssertDirectory(existing, command, created, reservation.agentServiceId);
		await this.transaction.conversationParticipant.createMany({ data: created.participants.map(participant => ({ conversationId: command.conversationId, userId: participant.userId, visibleFromPosition: BigInt(participant.visibleFromPosition), joinedAt: new Date(participant.joinedAt) })), skipDuplicates: true });
		const participants = await this.transaction.conversationParticipant.findMany({ where: { conversationId: command.conversationId }, orderBy: { visibleFromPosition: "asc" } });
		if (participants.length !== created.participants.length || participants.some((participant, index) => participant.userId !== created.participants[index]?.userId || participant.visibleFromPosition !== BigInt(created.participants[index]?.visibleFromPosition ?? "-1")))
			throw new Error("Conversation creation projection participants do not match immutable history");
		const authorization = new PrismaConversationProductAuthorizationRepository(this.transaction);
		await authorization.reconcileParticipants(command.siloId, command.conversationId, created.participants.map(participant => participant.userId), created.provenance.principalId, new Date(created.createdAt));
		await authorization.reconcileCreator(command.siloId, command.conversationId, created.provenance.principalId, new Date(created.createdAt));
		if (created.mode === ConversationLifecycleModes.Agent)
			await new PrismaChannelTargetParticipantGrantProjectionRepository(this.transaction).reconcileConversation(command.conversationId, command.siloId, new Date(created.createdAt));
		const advanced = await this.transaction.conversationCreationReservation.updateMany({ where: { id: command.reservationId, state: ConversationCreationReservationState.HistoryAnchored }, data: { state: ConversationCreationReservationState.Projected, projectedAt: new Date() } });
		if (advanced.count === 0)
		{
			const current = await this.transaction.conversationCreationReservation.findUnique({ where: { id: command.reservationId }, select: { state: true } });
			if (current?.state !== ConversationCreationReservationState.Projected)
				throw new Error("Conversation creation projection did not converge");
		}
	}
}

/** Rejects a history event whose immutable facts do not match the durable pre-history reservation. */
function _AssertAnchor(reservation: { readonly mode: ConversationMode; readonly principalId: string; readonly agentServiceId: string | null; readonly agentRevisionId: string | null; readonly agentIdentityId: string | null; readonly profileRevisionId: string | null; readonly computerId: string | null; readonly participants: readonly { readonly userId: string; readonly visibleFromPosition: bigint }[] }, created: ConversationCreated): void
{
	if (_Mode(created.mode) !== reservation.mode || created.provenance.principalId !== reservation.principalId)
		throw new Error("Conversation creation projection anchor does not match its reservation");
	if (!_MatchesAgentBinding(reservation, created.agentBinding))
		throw new Error("Conversation creation projection agent binding does not match its reservation");
	if (reservation.participants.length !== created.participants.length || reservation.participants.some((participant, index) => participant.userId !== created.participants[index]?.userId || participant.visibleFromPosition !== BigInt(created.participants[index]?.visibleFromPosition ?? "-1")))
		throw new Error("Conversation creation projection anchor participants do not match its reservation");
}

/** Requires immutable Agent coordinates to retain the exact service, identity, revision, profile, and computer. */
function _MatchesAgentBinding(reservation: { readonly agentServiceId: string | null; readonly agentRevisionId: string | null; readonly agentIdentityId: string | null; readonly profileRevisionId: string | null; readonly computerId: string | null }, binding: ConversationCreated["agentBinding"]): boolean
{
	if (reservation.agentServiceId === null && reservation.agentRevisionId === null && reservation.agentIdentityId === null && reservation.profileRevisionId === null && reservation.computerId === null)
		return binding === null;
	return binding !== null && binding.agentServiceId === reservation.agentServiceId && binding.agentRevisionId === reservation.agentRevisionId && binding.agentIdentityId === reservation.agentIdentityId && binding.profileRevisionId === reservation.profileRevisionId && binding.computerId === reservation.computerId;
}

/** Refuses an existing directory row unless it is the exact idempotent materialization of the anchor. */
function _AssertDirectory(conversation: { readonly siloId: string; readonly mode: ConversationMode; readonly agentServiceId: string | null }, command: ConversationCreationProjectionCommand, created: ConversationCreated, agentServiceId: string | null): void
{
	if (conversation.siloId !== command.siloId || conversation.mode !== _Mode(created.mode) || conversation.agentServiceId !== agentServiceId)
		throw new Error("Conversation creation projection directory does not match immutable history");
}

/** Maps immutable lifecycle modes to the target database enum without accepting widened strings. */
function _Mode(mode: ConversationLifecycleModes): ConversationMode
{
	if (mode === ConversationLifecycleModes.Agent)
		return ConversationMode.AgentSession;
	if (mode === ConversationLifecycleModes.Direct)
		return ConversationMode.Direct;
	return ConversationMode.Group;
}
