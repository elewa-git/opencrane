import { isDeepStrictEqual } from "node:util";

import { Prisma, type PrismaClient } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import type { PrepareRoutineOccurrenceCommand, RoutineOccurrenceCommand, RoutineOccurrencePreparationPort, RoutineOccurrencePreparationReceipt, RoutineOccurrencePreparationRepository } from "@opencrane/backend/server/agents/scheduling/contract";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { PrismaRoutineOccurrenceProjectionRepository } from "./prisma-routine-occurrence-projection-repository";
import { _RoutinePreparationReceipt } from "./routine-occurrence-history.mapper";
import { _RoutineInstructionCoordinates } from "./routine-occurrence-preparation.mapper";
import type { RoutineOccurrencePreparationDependencies, RoutineOccurrencePreparedProjection, RoutineOccurrenceProjectionRepository } from "./routine-occurrence-preparation.types";

/**
 * Prepares a routine conversation without exposing partial history or restoring revoked access.
 * Database retries check permissions, projection fields and encrypted bytes. Plaintext is compared
 * in memory but never persisted. Occurrence history is established between transactions, outside
 * database retries. Participants, grants and the firing receipt commit
 * together; the receipt recovers a lost response without another audience reconciliation or restored access.
 */
export class PrismaRoutineOccurrencePreparationUnitOfWork implements RoutineOccurrencePreparationPort
{
	/** Keeps the root client outside repository operations and injects the existing history owners. */
	public constructor(private readonly prisma: PrismaClient, private readonly dependencies: RoutineOccurrencePreparationDependencies<Prisma.TransactionClient>) {}

	/** Returns the checked receipt, or null after committing a refusal; integrity failures propagate. */
	public prepare(command: PrepareRoutineOccurrenceCommand): Promise<RoutineOccurrencePreparationReceipt | null>
	{
		const self = this;
		return ___DoWithTrace("routine.occurrence_prepare", { siloId: command.siloId, firingId: command.firingId, conversationId: command.conversationId }, async function _Prepare()
		{
			return await self._prepare(command);
		});
	}

	/** Orders private staging, immutable history and final publication without a distributed transaction. */
	private async _prepare(command: PrepareRoutineOccurrenceCommand): Promise<RoutineOccurrencePreparationReceipt | null>
	{
		const { instruction, ...coordinates } = command;
		const occurrence: RoutineOccurrenceCommand = coordinates;
		const payload = this.dependencies.cipher.encrypt(instruction, _RoutineInstructionCoordinates(command.siloId, command.conversationId));
		// 1. Commit encrypted bytes and fixed computer coordinates before attempting any history write.
		const staged = await this._transaction(async function _Stage(routines, projection): Promise<RoutineOccurrencePreparedProjection | null>
		{
			const authorization = await routines.authorize(occurrence);
			if (authorization === null)
				return null;
			const published = authorization.preparation !== null;
			const record = await projection.stage({ command, payload, requireExisting: published, published });
			if (record === null)
			{
				await routines.refuse(occurrence);
				return null;
			}
			return { record, preparation: authorization.preparation };
		});
		if (staged === null)
			return null;
		// 2. A saved publication may be recovered, but missing or different history must never be rebuilt.
		if (staged.preparation !== null)
		{
			const saved = await this.dependencies.history.readRecord(command.siloId, command.conversationId);
			if (!isDeepStrictEqual(saved, staged.record) || !isDeepStrictEqual(staged.preparation, _RoutinePreparationReceipt(staged.record)))
				throw new Error("Published routine occurrence has inconsistent preparation history");
			return staged.preparation;
		}
		const receipt = await this.dependencies.history.establish(staged.record);
		if (!isDeepStrictEqual(receipt, _RoutinePreparationReceipt(staged.record)))
			throw new Error("Routine occurrence history returned a different preparation receipt");
		// 3. Repeat current checks and publish access together with the marker that closes replay.
		return await this._transaction(async function _Publish(routines, projection): Promise<RoutineOccurrencePreparationReceipt | null>
		{
			const authorization = await routines.authorize(occurrence);
			if (authorization === null)
				return null;
			const published = authorization.preparation !== null;
			const current = await projection.stage({ command, payload, requireExisting: true, published });
			if (current === null)
			{
				await routines.refuse(occurrence);
				return null;
			}
			if (!isDeepStrictEqual(current, staged.record))
				throw new Error("Routine occurrence projection changed before publication");
			if (authorization.preparation !== null)
			{
				if (!isDeepStrictEqual(authorization.preparation, receipt))
					throw new Error("Routine occurrence publication receipt conflicts with its history");
				return authorization.preparation;
			}
			await projection.publish(current);
			const saved = await routines.record(occurrence, receipt);
			if (!isDeepStrictEqual(saved, receipt))
				throw new Error("Routine occurrence publication saved a different receipt");
			return saved;
		});
	}

	/** Shares one Serializable transaction across scheduling checks, encrypted data and audience grants. */
	private _transaction<Result>(operation: (routines: RoutineOccurrencePreparationRepository, projection: RoutineOccurrenceProjectionRepository) => Promise<Result>): Promise<Result>
	{
		const dependencies = this.dependencies;
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Transaction(transaction: Prisma.TransactionClient)
		{
			const routines = dependencies.routines(transaction);
			const projection = new PrismaRoutineOccurrenceProjectionRepository(transaction, dependencies.cipher, dependencies.agents);
			return await operation(routines, projection);
		}, { operation: "routine-occurrence-preparation", isolationLevel: Prisma.TransactionIsolationLevel.Serializable, attemptLimit: 3 });
	}
}
