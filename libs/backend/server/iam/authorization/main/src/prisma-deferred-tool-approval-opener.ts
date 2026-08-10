import { ActionExecutionState, Prisma, type PrismaClient } from "@prisma/client";

import { ___DoWithTrace, type Logger } from "@opencrane/backend/observability";

import { __DigestCanonicalJson } from "./canonical-json-digest.js";
import { __DeferToolRequest } from "./deferred-tool-approval.js";
import { __ProjectDeferredToolApproval, __ValidateDeferredToolArguments } from "./deferred-tool-approval-schema.js";
import type { DeferredToolApprovalOpenRepository, DeferredToolApprovalOpenUnitOfWork, DeferToolRequestCommand, DeferToolRequestResult, OpenDeferredToolApprovalCommand } from "./deferred-tool-approval.types.js";

/** One transaction-scoped operation over the approval-open repository. */
type ApprovalOpenTransaction = <TResult>(operation: (repository: DeferredToolApprovalOpenRepository) => Promise<TResult>) => Promise<TResult>;

/** Transaction-scoped deferred approval open/recovery repository. */
class PrismaDeferredToolApprovalOpenRepository implements DeferredToolApprovalOpenRepository
{
	/** Exact transaction binding; never a process-owned root client. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind every operation to the caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Open one approval through the canonical in-transaction authority. */
	async defer(command: DeferToolRequestCommand): Promise<DeferToolRequestResult>
	{
		return __DeferToolRequest(this._transaction, command);
	}

	/** Terminalise one reservation only while it remains Reserved. */
	async markReservedFailed(reservationId: string, failureCode: string, now: Date): Promise<boolean>
	{
		const failed = await this._transaction.toolInvocation.updateMany({ where: { id: reservationId, state: ActionExecutionState.Reserved }, data: { state: ActionExecutionState.Failed, failureCode, completedAt: now } });
		return failed.count === 1;
	}

	/** Read only the exact durable linkage that proves an ambiguous create committed. */
	async hasLinkedApproval(command: OpenDeferredToolApprovalCommand): Promise<boolean>
	{
		const approval = await this._transaction.approvalRequest.findFirst({ where: { id: command.interruptId, runId: command.runId, attempt: command.attempt, toolInvocationRowId: command.reservationId } });
		return approval !== null;
	}
}

/**
 * Open a pending approval for one reserved tool invocation without stranding replayable work.
 *
 * The create and unavailable-terminalisation paths share one transaction. If the transaction throws
 * after the database may have committed, the recovery read first treats a linked approval as proof
 * of success; only an unlinked reservation is compare-and-set to Failed. This keeps every
 * post-reservation ambiguity terminal and prevents a runtime replay from dispatching the action.
 *
 * @param prisma - Canonical authorization persistence client.
 * @param command - Exact reserved invocation, effective policy, and server-owned time bounds.
 * @param logger - Structured logger used when ambiguous recovery needs operator attention.
 * @returns True when an approval exists, otherwise false after best-effort terminalisation.
 * @throws When neither approval existence nor reservation terminalisation can be proven.
 */
export async function __OpenDeferredToolApproval(prisma: PrismaClient, command: OpenDeferredToolApprovalCommand, logger: Logger): Promise<boolean>
{
	return new PrismaDeferredToolApprovalOpenUnitOfWork(prisma, logger).open(command);
}

/** Prisma unit of work for deferred-approval open and ambiguous-commit recovery. */
class PrismaDeferredToolApprovalOpenUnitOfWork implements DeferredToolApprovalOpenUnitOfWork
{
	/** Process-owned Prisma root used only to begin exact transactions. */
	private readonly _prisma: PrismaClient;
	/** Structured evidence sink that never receives argument or proof bodies. */
	private readonly _logger: Logger;

	/** Compose the unit of work from the process-owned database and bounded logger. */
	constructor(prisma: PrismaClient, logger: Logger)
	{
		this._prisma = prisma;
		this._logger = logger;
	}

	/** Open one traced deferred approval and recover an ambiguous commit fail closed. */
	async open(command: OpenDeferredToolApprovalCommand): Promise<boolean>
	{
		const prisma = this._prisma;
		const logger = this._logger;
		async function _withRepository<TResult>(operation: (repository: DeferredToolApprovalOpenRepository) => Promise<TResult>): Promise<TResult>
		{
			return prisma.$transaction(async function _transaction(transaction): Promise<TResult>
			{
				return operation(new PrismaDeferredToolApprovalOpenRepository(transaction));
			}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
		}
		return ___DoWithTrace("approval.open", { runId: command.runId, attempt: command.attempt }, async function _traceOpen()
		{
			return _openDeferredToolApproval(command, logger, _withRepository);
		});
	}
}

/** Perform the traced unit-of-work body without exposing Prisma beyond this module. */
async function _openDeferredToolApproval(command: OpenDeferredToolApprovalCommand, logger: Logger, transaction: ApprovalOpenTransaction): Promise<boolean>
{
	const argumentsDigest = __DigestCanonicalJson(command.arguments);
	const parametersSchemaDigest = __DigestCanonicalJson(command.parametersSchema);
	if (argumentsDigest !== command.argumentsDigest || parametersSchemaDigest !== command.parametersSchemaDigest || !__ValidateDeferredToolArguments(command.parametersSchema, command.arguments))
	{
		await transaction(async function _invalid(repository)
		{
			await repository.markReservedFailed(command.reservationId, "approval_arguments_invalid", command.now);
		});
		return false;
	}
	const projection = __ProjectDeferredToolApproval(command.parametersSchema, command.arguments);
	try
	{
		return await transaction(async function _defer(repository): Promise<boolean>
		{
			// 1. Create the approval against the same live workload and proof-key fence as the run.
			const result = await repository.defer({
				interruptId: command.interruptId,
				runId: command.runId,
				attempt: command.attempt,
				toolInvocationRowId: command.reservationId,
				toolRevisionId: command.toolRevisionId,
				reviewedArguments: command.arguments,
				argumentsDigest: command.argumentsDigest,
				reviewedParametersSchema: command.parametersSchema,
				reviewedParametersSchemaDigest: parametersSchemaDigest,
				safeProposedArguments: projection.proposedArguments,
				responseSchema: projection.responseSchema,
				actionDigest: __DigestCanonicalJson({ runId: command.runId, attempt: command.attempt, toolInvocationId: command.toolInvocationId, toolRevisionId: command.toolRevisionId, argumentsDigest: command.argumentsDigest }),
				effectivePolicyDigest: command.capabilitySetDigest,
				approverPolicyRevision: "mcp-server-requires-approval",
				now: command.now,
				expiresAt: command.expiresAt,
			});
			if (result.outcome !== "unavailable") return true;

			// 2. A missing live workload makes the reserved invocation terminal in the same commit.
			if (!await repository.markReservedFailed(command.reservationId, "approval_unavailable", command.now)) throw new Error("deferred approval lost its reserved invocation fence");
			return false;
		});
	}
	catch (transactionError)
	{
		const evidence = { runId: command.runId, attempt: command.attempt, reservationId: command.reservationId, toolInvocationId: command.toolInvocationId };
		logger.warn({ err: transactionError, ...evidence }, "deferred approval transaction outcome is ambiguous");

		// 3. A linked approval proves an ambiguous transaction committed before its connection failed.
		try
		{
			const linked = await transaction(async function _recoverRead(repository)
			{
				return repository.hasLinkedApproval(command);
			});
			if (linked) return true;
		}
		catch (recoveryReadError)
		{
			logger.error({ err: recoveryReadError, ...evidence }, "deferred approval recovery read failed");
		}

		// 4. Otherwise close the reservation so the same side effect can never be replayed ambiguously.
		try
		{
			await transaction(async function _terminalise(repository)
			{
				if (!await repository.markReservedFailed(command.reservationId, "approval_defer_failed", command.now)) throw new Error("deferred approval reservation is no longer reserved");
			});
			return false;
		}
		catch (terminalisationError)
		{
			logger.error({ err: terminalisationError, ...evidence }, "deferred approval recovery could not terminalise reserved invocation");
			throw new Error("deferred approval recovery could not terminalise reserved invocation", { cause: terminalisationError });
		}
	}
}
