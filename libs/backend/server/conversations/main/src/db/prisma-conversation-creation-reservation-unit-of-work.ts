import type { PrismaClient } from "@prisma/client";

import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { AnchorConversationCreationReservationCommand, ReserveConversationCreationCommand, ReserveConversationCreationResult, ReservedConversationCreation } from "../conversation-creation-reservation.types";
import type { ConversationCreationReservationUnitOfWork } from "../history-anchored-conversation-creation-authority.types";
import type { ConversationCaller } from "../types/conversation-caller.types";
import { PrismaConversationCreationReservationRepository } from "./prisma-conversation-creation-reservation-repository";

/** Opens the short serializable reservation transactions on either side of immutable history I/O. */
export class PrismaConversationCreationReservationUnitOfWork implements ConversationCreationReservationUnitOfWork
{
	/** Holds the request-scoped caller whose authorization evidence each reservation transaction records. */
	public constructor(private readonly prisma: PrismaClient, private readonly caller: ConversationCaller) {}

	/** @inheritdoc */
	public async reserve(command: ReserveConversationCreationCommand): Promise<ReserveConversationCreationResult>
	{
		return this._Run(function _Reserve(repository): Promise<ReserveConversationCreationResult> { return repository.reserve(command); }, "conversation creation reservation");
	}

	/** @inheritdoc */
	public async markHistoryAnchored(command: AnchorConversationCreationReservationCommand): Promise<ReservedConversationCreation>
	{
		return this._Run(function _MarkHistoryAnchored(repository): Promise<ReservedConversationCreation> { return repository.markHistoryAnchored(command); }, "conversation creation history anchor");
	}

	/** Runs one short reservation operation without holding its transaction across immutable history I/O. */
	private _Run<Result>(operation: (repository: PrismaConversationCreationReservationRepository) => Promise<Result>, name: string): Promise<Result>
	{
		const caller = this.caller;
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Transaction(transaction): Promise<Result>
		{
			return operation(new PrismaConversationCreationReservationRepository(transaction, caller));
		}, { isolationLevel: "Serializable", attemptLimit: 3, operation: name });
	}
}
