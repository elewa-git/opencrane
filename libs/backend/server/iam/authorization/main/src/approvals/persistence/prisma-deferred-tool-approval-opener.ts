import { Prisma, type PrismaClient } from "@prisma/client";

import { ___ConversationToolArgumentsSchema } from "@opencrane/contracts";
import { ___DoWithTrace, type Logger } from "@opencrane/backend/observability";

import { __DigestCanonicalJson } from "../../authority/canonical-json-digest";
import { __DeferToolRequest } from "../deferred-tool-approval-opening";
import { _IsApprovalRequestFenceRejection } from "../deferred-tool-approval-fence";
import { __ProjectDeferredToolApproval, __ValidateDeferredToolArguments } from "../deferred-tool-approval-schema";
import { DeferToolRequestOutcomes, type DeferredToolApprovalOpenRepository, type DeferredToolApprovalOpenUnitOfWork, type DeferToolRequestCommand, type DeferToolRequestResult, type OpenDeferredToolApprovalCommand } from "../deferred-tool-approval-open.types";
import { __MarkToolInvocationApprovalRejectedInTransaction } from "../../tool-invocations/persistence/tool-invocation-transaction";

/** One transaction-scoped operation over the approval-open repository. */
type ApprovalOpenTransaction = <TResult>(operation: (repository: DeferredToolApprovalOpenRepository) => Promise<TResult>) => Promise<TResult>;

/** The three operations used while opening one approval, all on the caller's transaction. */
class PrismaDeferredToolApprovalOpenRepository implements DeferredToolApprovalOpenRepository
{
	/** The transaction every query here runs on; never the process-wide Prisma client. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind every operation to the caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Open one approval through the repository bound to this transaction. */
	async defer(command: DeferToolRequestCommand): Promise<DeferToolRequestResult>
	{
		return __DeferToolRequest(this._transaction, command);
	}

	/** Fails the invocation only while it is still in AwaitingApproval. */
	async terminaliseAwaitingApproval(invocationId: string, failureCode: string, now: Date): Promise<boolean>
	{
		return __MarkToolInvocationApprovalRejectedInTransaction(this._transaction, invocationId, now, failureCode);
	}

	/** Returns whether the approval row exists and points at this invocation, which proves the create committed. */
	async hasLinkedApproval(command: OpenDeferredToolApprovalCommand): Promise<boolean>
	{
		const approval = await this._transaction.approvalRequest.findFirst({ where: { id: command.interruptId, runId: command.runId, attempt: command.attempt, toolInvocationRowId: command.invocationId } });
		return approval !== null;
	}
}

/**
 * Open a pending approval for one prepared tool invocation without stranding replayable work.
 *
 * The create and unavailable-terminalisation paths share one transaction. If the transaction throws
 * after the database may have committed, the recovery read first treats a linked approval as proof
 * of success; only an unlinked invocation is compare-and-set to Failed. This keeps every
 * post-preparation ambiguity terminal and prevents a worker from dispatching the action.
 *
 * @param prisma - Authorization persistence client.
 * @param command - Prepared invocation, effective policy, and server-owned time bounds.
 * @param logger - Structured logger used when ambiguous recovery needs operator attention.
 * @returns True when an approval exists, otherwise false after best-effort invocation failure.
 * @throws When neither approval existence nor invocation failure can be proven.
 */
export async function __OpenDeferredToolApproval(prisma: PrismaClient, command: OpenDeferredToolApprovalCommand, logger: Logger): Promise<boolean>
{
	const unitOfWork = new PrismaDeferredToolApprovalOpenUnitOfWork(prisma, logger);
	return unitOfWork.open(command);
}

/** Open one approval inside an existing caller-owned transaction without creating a nested transaction. */
export async function __OpenDeferredToolApprovalInTransaction(transaction: Prisma.TransactionClient, command: OpenDeferredToolApprovalCommand): Promise<boolean>
{
	const argumentsDigest = __DigestCanonicalJson(command.arguments);
	const parametersSchemaDigest = __DigestCanonicalJson(command.parametersSchema);
	if (!___ConversationToolArgumentsSchema.safeParse(command.arguments).success || argumentsDigest !== command.argumentsDigest || parametersSchemaDigest !== command.parametersSchemaDigest || !__ValidateDeferredToolArguments(command.parametersSchema, command.arguments))
	{
		await __MarkToolInvocationApprovalRejectedInTransaction(transaction, command.invocationId, command.now, "approval_arguments_invalid");
		return false;
	}
	const projection = __ProjectDeferredToolApproval(command.parametersSchema, command.arguments);
	const result = await __DeferToolRequest(transaction, {
		interruptId: command.interruptId,
		runId: command.runId,
		attempt: command.attempt,
		toolInvocationRowId: command.invocationId,
		toolRevisionId: command.toolRevisionId,
		toolName: command.toolName,
		toolDescription: command.toolDescription,
		externalSystemName: command.externalSystemName,
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
	if (result.outcome !== DeferToolRequestOutcomes.Unavailable)
		return true;
	if (!await __MarkToolInvocationApprovalRejectedInTransaction(transaction, command.invocationId, command.now, "approval_unavailable"))
		throw new Error("deferred approval lost its awaiting-approval invocation fence");
	return false;
}

/** Opens one approval and cleans up when the transaction throws without revealing whether it committed. */
class PrismaDeferredToolApprovalOpenUnitOfWork implements DeferredToolApprovalOpenUnitOfWork
{
	/** Process-owned Prisma root used to begin transactions. */
	private readonly _prisma: PrismaClient;
	/** Structured evidence sink that never receives argument or proof bodies. */
	private readonly _logger: Logger;

	/** Composes the unit of work from the process-owned database and structured logger. */
	constructor(prisma: PrismaClient, logger: Logger)
	{
		this._prisma = prisma;
		this._logger = logger;
	}

	/** Opens one approval inside a trace, and when the transaction outcome is unclear, resolves it without letting the action run. */
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

/** Fail the still-awaiting invocation because nothing can own its approval; throws when another writer already moved it on. */
async function _closeUnavailableInvocation(repository: DeferredToolApprovalOpenRepository, command: OpenDeferredToolApprovalCommand): Promise<boolean>
{
	if (!await repository.terminaliseAwaitingApproval(command.invocationId, "approval_unavailable", command.now))
		throw new Error("deferred approval lost its awaiting-approval invocation fence");
	return false;
}

/** Perform the traced unit-of-work body without exposing Prisma beyond this module. */
async function _openDeferredToolApproval(command: OpenDeferredToolApprovalCommand, logger: Logger, transaction: ApprovalOpenTransaction): Promise<boolean>
{
	const argumentsDigest = __DigestCanonicalJson(command.arguments);
	const parametersSchemaDigest = __DigestCanonicalJson(command.parametersSchema);
	if (!___ConversationToolArgumentsSchema.safeParse(command.arguments).success || argumentsDigest !== command.argumentsDigest || parametersSchemaDigest !== command.parametersSchemaDigest || !__ValidateDeferredToolArguments(command.parametersSchema, command.arguments))
	{
		await transaction(async function _invalid(repository)
		{
				await repository.terminaliseAwaitingApproval(command.invocationId, "approval_arguments_invalid", command.now);
		});
		return false;
	}
	const projection = __ProjectDeferredToolApproval(command.parametersSchema, command.arguments);
	try
	{
		return await transaction(async function _defer(repository): Promise<boolean>
		{
			// 1. Create the approval against the same immutable execution subject and computer-lease fence as the run.
			const result = await repository.defer({
				interruptId: command.interruptId,
				runId: command.runId,
				attempt: command.attempt,
				toolInvocationRowId: command.invocationId,
				toolRevisionId: command.toolRevisionId,
				toolName: command.toolName,
				toolDescription: command.toolDescription,
				externalSystemName: command.externalSystemName,
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
			if (result.outcome !== DeferToolRequestOutcomes.Unavailable)
				return true;

			// 2. A run, invocation, or approver that can no longer own an approval makes the awaiting invocation terminal in the same commit.
			return _closeUnavailableInvocation(repository, command);
		});
	}
	catch (transactionError)
	{
		// 3. The approval_requests trigger is the single computer-lease fence. When it rejects the create,
		//    PostgreSQL rolled the attempt back, so close the invocation in a fresh transaction exactly as step 2 does.
		if (_IsApprovalRequestFenceRejection(transactionError))
		{
			return transaction(async function _unavailable(repository): Promise<boolean>
			{
				return _closeUnavailableInvocation(repository, command);
			});
		}
		const evidence = { runId: command.runId, attempt: command.attempt, invocationId: command.invocationId, toolInvocationId: command.toolInvocationId };
		logger.warn({ err: transactionError, ...evidence }, "deferred approval transaction outcome is ambiguous");

		// 4. A linked approval proves an ambiguous transaction committed before its connection failed.
		try
		{
			const linked = await transaction(async function _recoverRead(repository)
			{
				return repository.hasLinkedApproval(command);
			});
			if (linked)
				return true;
		}
		catch (recoveryReadError)
		{
			logger.error({ err: recoveryReadError, ...evidence }, "deferred approval recovery read failed");
		}

		// 5. Recheck linkage and close the invocation inside one transaction. A transient failure in the
		// first recovery read can never turn an already-committed approval into a failed invocation.
		try
		{
			return await transaction(async function _terminalise(repository): Promise<boolean>
			{
				if (await repository.hasLinkedApproval(command))
					return true;
				if (!await repository.terminaliseAwaitingApproval(command.invocationId, "approval_defer_failed", command.now))
					throw new Error("deferred approval invocation is no longer awaiting approval");
				return false;
			});
		}
		catch (terminalisationError)
		{
				logger.error({ err: terminalisationError, ...evidence }, "deferred approval recovery could not terminalise invocation");
				throw new Error("deferred approval recovery could not terminalise invocation", { cause: terminalisationError });
		}
	}
}
