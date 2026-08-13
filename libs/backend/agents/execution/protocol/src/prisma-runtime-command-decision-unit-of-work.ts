import { RuntimeCommandKind, type Prisma } from "@prisma/client";

import type { RuntimeElicitationUnitOfWork } from "@opencrane/backend/agents/execution/elicitation";

import { PrismaRuntimeResumeInputRepository } from "./prisma-runtime-resume-input-repository.js";
import type { RuntimeApprovalExpiry, RuntimeCommandDecisionUnitOfWork } from "./prisma-runtime-dispatch-authority.types.js";
import type { RuntimeAdmissionRunState } from "./runtime-protocol-authority.types.js";

/**
 * Decides the next runtime command, and closes overdue approvals, on the caller's transaction.
 *
 * Constructed per poll and never held, because everything it reads is only sound while the caller's
 * run lock is held. Keeping the decision here means the dispatch authority never reads approval or
 * tool-result tables itself.
 *
 * Called by: `_nextCommand` in prisma-runtime-dispatch-authority.ts, once per poll.
 *
 * @implements RuntimeCommandDecisionUnitOfWork
 */
export class PrismaRuntimeCommandDecisionUnitOfWork implements RuntimeCommandDecisionUnitOfWork
{
	/** The caller's dispatch transaction, which already holds the locks on the run, the assignment, and the command stream. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Read state and close approvals only on the caller's dispatch transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/**
	 * Close approvals whose deadline has passed, while command polling holds the run lock.
	 *
	 * @param context - Run, attempt, and current run state.
	 * @param approvalExpiry - The injected expiry port, or null when none was wired.
	 * @param elicitationUnitOfWork - Generic request expiry already bound to this same transaction.
	 * @param now - Trusted server time.
	 * @returns `not_required` - the run is not waiting for approval; carry on and decide a command.
	 * `applied` - deadlines were processed, which obliges the caller to re-read the run before deciding,
	 * because it may now be resumable or cancelling. `unavailable` - the run is waiting but no expiry
	 * port exists, so the caller must send nothing at all rather than guess the wait is over.
	 */
	async expireWaiting(context: { readonly runId: string; readonly attempt: number; readonly runState: RuntimeAdmissionRunState }, approvalExpiry: RuntimeApprovalExpiry | null, elicitationUnitOfWork: RuntimeElicitationUnitOfWork, now: Date): Promise<"not_required" | "applied" | "unavailable">
	{
		if (context.runState !== "waiting_for_input") return "not_required";
		if (approvalExpiry === null) return "unavailable";
		await approvalExpiry.expireInTransaction(this._transaction, { runId: context.runId, attempt: context.attempt, now });
		await elicitationUnitOfWork.expireDue({ runId: context.runId, attempt: context.attempt, now });
		return "applied";
	}

	/**
	 * Choose the next command from the run's saved state and its pending rows.
	 *
	 * There is only ever one start and one cancel. The first resume may carry either a saved tool
	 * result or steering. A later resume needs a new tool-result row, which proves another batch of
	 * tools finished; steering on its own cannot interrupt a running agent loop.
	 *
	 * @param context - Run, attempt, and current run state.
	 * @param commands - Commands already sent for this attempt, so a second start or cancel cannot be
	 * produced.
	 * @returns The command kind to create, or null when nothing is due - the normal idle answer.
	 */
	async decide(context: { readonly runId: string; readonly attempt: number; readonly runState: RuntimeAdmissionRunState }, commands: readonly { readonly kind: RuntimeCommandKind }[]): Promise<RuntimeCommandKind | null>
	{
		const hasStart = commands.some(function _IsStart(row) { return row.kind === RuntimeCommandKind.StartAttempt; });
		if (context.runState === "cancelling") return commands.some(function _IsCancel(row) { return row.kind === RuntimeCommandKind.CancelAttempt; }) ? null : RuntimeCommandKind.CancelAttempt;
		if ((context.runState === "assigned" || context.runState === "running") && !hasStart) return RuntimeCommandKind.StartAttempt;
		if (context.runState !== "running" || !hasStart) return null;

		const loaded = await new PrismaRuntimeResumeInputRepository(this._transaction).load(context.runId, context.attempt, 0);
		if (loaded === null) return null;
		const hasResume = commands.some(function _IsResume(row) { return row.kind === RuntimeCommandKind.ResumeAttempt; });
		return hasResume && loaded.toolResultDeliveryIds.length === 0 && loaded.elicitationResultDeliveryIds.length === 0 ? null : RuntimeCommandKind.ResumeAttempt;
	}
}
