import { ConversationLifecycle, ConversationMode, PrincipalProvenance, type Prisma } from "@prisma/client";

import { PrismaManagedAgentConversationResolver, type ManagedAgentConversationDependencies } from "@opencrane/backend/server/agents/agent-services";
import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";

import { PrismaConversationProductAuthorizationRepository } from "../authorization/db/conversation-product-authorization";
import { PrismaConversationHistoryRepository } from "../messages/db/prisma-conversation-history-repository";
import { _RoutineEventId } from "./routine-occurrence-history.mapper";
import type { RoutineOccurrenceHistoryRecord } from "./routine-occurrence-history.types";
import { _RoutineOccurrenceHistoryRecordSchema } from "./routine-occurrence-history.validator";
import { _RoutineComputerId, _RoutineInstructionCoordinates, _RoutinePreparedRecord } from "./routine-occurrence-preparation.mapper";
import type { RoutineOccurrenceProjectionRepository, RoutineOccurrenceProjectionStage } from "./routine-occurrence-preparation.types";

/** Reads coordinates and every existing participant so an unmarked projection cannot be republished. */
const _PROJECTION_SELECT = {
	id: true, siloId: true, mode: true, lifecycle: true, agentServiceId: true,
	computerId: true, computerAgentIdentityId: true, computerProfileRevisionId: true, createdAt: true,
	participants: { select: { userId: true } },
} satisfies Prisma.ConversationSelect;

/** Stores hidden occurrence data and publishes its audience without owning routine authorization. */
export class PrismaRoutineOccurrenceProjectionRepository implements RoutineOccurrenceProjectionRepository
{
	/** Uses the same transaction as the firing authorization and publication receipt. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly cipher: ConversationPrivatePayloadCipher, private readonly agents: ManagedAgentConversationDependencies) {}

	/**
	 * Saves a hidden projection and ciphertext, or verifies their original retry values.
	 * The caller authorizes the firing first. No participants or grants are created here. Current
	 * managed eligibility loss returns null; a changed saved coordinate or payload throws so the
	 * transaction cannot accept substituted evidence. Published recovery never recreates rows.
	 */
	public async stage(input: RoutineOccurrenceProjectionStage): Promise<RoutineOccurrenceHistoryRecord | null>
	{
		const { command } = input;
		let projection = await this.transaction.conversation.findUnique({ where: { id: command.conversationId }, select: _PROJECTION_SELECT });
		if (projection === null && input.requireExisting)
			throw new Error("Routine occurrence projection is missing after preparation");
		if (projection !== null && (projection.siloId !== command.siloId || projection.mode !== ConversationMode.AgentSession || projection.agentServiceId !== command.selectedManagedServiceId || projection.computerId !== _RoutineComputerId(command.conversationId)))
			throw new Error("Routine occurrence projection has conflicting ownership");
		if (!input.published)
		{
			if (projection !== null && projection.participants.length !== 0)
				throw new Error("Routine occurrence audience exists without its publication receipt");
			if (projection !== null && projection.lifecycle !== ConversationLifecycle.Open)
				return null;
			const resolver = new PrismaManagedAgentConversationResolver(this.transaction, this.agents);
			const candidate = await resolver.eligible({ siloId: command.siloId, principalId: command.requesterPrincipalId }, command.selectedManagedServiceId);
			if (candidate === null)
				return null;
			if (projection !== null && (projection.computerAgentIdentityId !== candidate.agentIdentityId || projection.computerProfileRevisionId !== candidate.profileRevisionId))
				return null;
			if (projection === null)
			{
				projection = await this.transaction.conversation.create({ data: { id: command.conversationId, siloId: command.siloId, mode: ConversationMode.AgentSession, agentServiceId: command.selectedManagedServiceId, computerId: _RoutineComputerId(command.conversationId), computerAgentIdentityId: candidate.agentIdentityId, computerProfileRevisionId: candidate.profileRevisionId }, select: _PROJECTION_SELECT });
			}
		}
		if (projection === null || projection.computerId === null || projection.computerAgentIdentityId === null || projection.computerProfileRevisionId === null)
			throw new Error("Routine occurrence projection lacks its computer identity");
		const coordinates = _RoutineInstructionCoordinates(command.siloId, command.conversationId);
		const history = new PrismaConversationHistoryRepository(this.transaction);
		const stored = await history.createOrReadAttestedPayload({ ...coordinates, idempotencyKey: _RoutineEventId("instruction", command.conversationId), payload: input.payload, requireExisting: input.requireExisting });
		if (this.cipher.decrypt(stored.payload, coordinates) !== command.instruction)
			throw new Error("Routine occurrence instruction differs from its saved ciphertext");
		const computer = { computerId: projection.computerId, agentIdentityId: projection.computerAgentIdentityId, profileRevisionId: projection.computerProfileRevisionId, createdAt: projection.createdAt };
		return _RoutineOccurrenceHistoryRecordSchema.parse(_RoutinePreparedRecord(command, computer, stored.payload));
	}

	/**
	 * Creates the exact confirmed audience after checked history is ready.
	 * The caller must have rechecked authority and the hidden projection in this transaction, and
	 * must save the firing receipt before committing. Any failure rolls back participants and grants.
	 */
	public async publish(record: RoutineOccurrenceHistoryRecord): Promise<void>
	{
		const principals = await this.transaction.principal.findMany({ where: { siloId: record.siloId, id: { in: [...record.audiencePrincipalIds] }, provenance: PrincipalProvenance.External }, select: { id: true, subject: true } });
		if (principals.length !== record.audiencePrincipalIds.length || new Set(principals.map(principal => principal.subject)).size !== principals.length)
			throw new Error("Routine occurrence audience is missing or ambiguous");
		const subjects = record.audiencePrincipalIds.map(function _Subject(principalId)
		{
			const principal = principals.find(value => value.id === principalId);
			if (principal === undefined)
				throw new Error("Routine occurrence audience changed during publication");
			return principal.subject;
		});
		await this.transaction.conversationParticipant.createMany({ data: subjects.map(userId => ({ conversationId: record.conversationId, userId, visibleFromPosition: 1n, readThroughPosition: 0n })) });
		const authorization = new PrismaConversationProductAuthorizationRepository(this.transaction);
		const now = new Date();
		await authorization.reconcileParticipants(record.siloId, record.conversationId, subjects, record.requesterPrincipalId, now);
		await authorization.reconcileCreator(record.siloId, record.conversationId, record.requesterPrincipalId, now);
	}
}
