import { isDeepStrictEqual } from "node:util";

import { Prisma, type PrismaClient } from "@prisma/client";

import type { RoutineComputerActivationReceipt, RoutineOccurrenceActivationRepository, RoutineOccurrenceActivationRepositoryFactory, RoutineOccurrenceCommand, RoutineOccurrencePreparationReceipt } from "@opencrane/backend/server/agents/scheduling/contract";
import type { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { PrismaConversationComputerActivationProjectionRepository } from "../computers/activation/db/prisma-conversation-computer-activation-repository";
import type { ConversationComputerActivationCommand, ConversationComputerActivationProjection, ConversationComputerActivationProjectionStore, ConversationComputerActiveLeaseProjectionCommand } from "../computers/activation/conversation-computer-activation.types";
import { RoutineActivationRefusedError } from "./routine-activation-refused";
import { _AssertRoutineActivationComputer, _RoutineActivationCommand, _RoutineActivationEnded, _RoutineActivationReceipt } from "./routine-computer-activation.mapper";
import type { RoutineComputerActivationProjection } from "./routine-computer-activation.types";
import type { RoutineOccurrenceHistoryRecord } from "./routine-occurrence-history.types";

/**
 * Publishes a routine's lease and activation receipt together without admitting a turn task.
 * History reads happen outside retried SQL transactions. Current scheduling authority is checked
 * inside the transaction that writes the projection. Refusal commits before its signal is thrown.
 */
export class PrismaRoutineComputerActivationProjectionUnitOfWork implements RoutineComputerActivationProjection
{
	/** Holds the committed receipt from this activation call, not a process-wide cache. */
	public receipt: RoutineComputerActivationReceipt | null = null;

	/** Keeps root database access separate from the transaction-bound scheduling and projection owners. */
	public constructor(private readonly prisma: PrismaClient, private readonly routines: RoutineOccurrenceActivationRepositoryFactory<Prisma.TransactionClient>, private readonly command: RoutineOccurrenceCommand, private readonly preparation: RoutineOccurrencePreparationReceipt, private readonly record: RoutineOccurrenceHistoryRecord, private readonly computers: Pick<ConversationComputerHistory, "load">) {}

	/** Rechecks current scheduling authority immediately before a sandbox claim is requested. */
	public async authorize(): Promise<RoutineComputerActivationReceipt | null>
	{
		const self = this;
		const authorization = await this._transaction(async function _Authorize(routines)
		{
			return await routines.authorize(self.command, self.preparation);
		});
		if (authorization === null)
			throw new RoutineActivationRefusedError();
		return authorization.activation;
	}

	/** Commits a confirmed terminal pre-admission outcome without erasing earlier receipts. */
	public async refuse(): Promise<never>
	{
		const self = this;
		await this._transaction(async function _Refuse(routines) { await routines.refuse(self.command, self.preparation); });
		throw new RoutineActivationRefusedError();
	}

	/** Resolves only the prepared computer after current scheduling authority is confirmed. */
	public async resolve(command: ConversationComputerActivationCommand): Promise<ConversationComputerActivationProjection | null>
	{
		if (!isDeepStrictEqual(command, _RoutineActivationCommand(this.record)))
			throw new Error("Routine activation requested a different computer command");
		const self = this;
		const projection = await this._transaction(async function _Resolve(routines, projections)
		{
			if (await routines.authorize(self.command, self.preparation) === null)
				return null;
			const resolved = await projections.resolve(command);
			self._assertProjection(resolved);
			return resolved;
		});
		if (projection === null)
			throw new RoutineActivationRefusedError();
		return projection;
	}

	/** Verifies active history, then saves its lease and receipt under a fresh authority check. */
	public async publishActiveLease(command: ConversationComputerActiveLeaseProjectionCommand, activation: Pick<ConversationComputerActivationCommand, "activationEventId" | "causationId" | "causationPosition">): Promise<void>
	{
		const expected = _RoutineActivationCommand(this.record);
		if (activation.activationEventId !== expected.activationEventId || activation.causationId !== expected.causationId || activation.causationPosition !== expected.causationPosition)
			throw new Error("Routine activation causation differs from its instruction");
		const current = await this.computers.load({ computer: { siloId: this.record.siloId, conversationId: this.record.conversationId, computerId: this.record.computerId, agentIdentityId: this.record.agentIdentityId }, profileRevisionId: this.record.profileRevisionId });
		_AssertRoutineActivationComputer(current);
		if (_RoutineActivationEnded(current, Date.now()))
			await this.refuse();
		const candidate = _RoutineActivationReceipt(this.record, this.preparation, current, command);
		if (Date.parse(command.lease.expiresAt) <= Date.now())
			await this.refuse();
		const self = this;
		const receipt = await this._transaction(async function _Publish(routines, projections)
		{
			const authorization = await routines.authorize(self.command, self.preparation);
			if (authorization === null)
				return null;
			if (Date.parse(command.lease.expiresAt) <= Date.now())
			{
				await routines.refuse(self.command, self.preparation);
				return null;
			}
			self._assertProjection(await projections.resolve(expected));
			if (authorization.activation !== null && !isDeepStrictEqual(authorization.activation, candidate))
				throw new Error("Routine activation receipt differs from current computer history");
			await projections.publishActiveLease(command);
			const saved = await routines.record(self.command, self.preparation, candidate);
			if (!isDeepStrictEqual(saved, candidate))
				throw new Error("Routine activation saved a different receipt");
			return saved;
		});
		if (receipt === null)
			throw new RoutineActivationRefusedError();
		this.receipt = receipt;
	}

	/** Rejects removed or substituted relational coordinates rather than rebuilding preparation. */
	private _assertProjection(projection: ConversationComputerActivationProjection | null): void
	{
		if (projection?.agentIdentityId !== this.record.agentIdentityId || projection.profileRevisionId !== this.record.profileRevisionId)
			throw new Error("Routine activation projection differs from its prepared computer");
	}

	/** Shares one Serializable transaction between scheduling and lease persistence; never spawns work. */
	private _transaction<Result>(operation: (routines: RoutineOccurrenceActivationRepository, projections: ConversationComputerActivationProjectionStore) => Promise<Result>): Promise<Result>
	{
		const factory = this.routines;
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Transaction(transaction: Prisma.TransactionClient)
		{
			const routines = factory(transaction);
			const projections = new PrismaConversationComputerActivationProjectionRepository(transaction);
			return await operation(routines, projections);
		}, { operation: "routine-computer-activation", isolationLevel: Prisma.TransactionIsolationLevel.Serializable, attemptLimit: 3 });
	}
}
