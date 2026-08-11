import { RuntimeCommandKind, type Prisma } from "@prisma/client";

import { PrismaRuntimeDeferredResumeRepository } from "./prisma-runtime-deferred-resume-repository.js";
import type { RuntimeApprovalExpiry, RuntimeCommandDecisionUnitOfWork } from "./prisma-runtime-dispatch-authority.types.js";
import type { RuntimeAdmissionRunState } from "./runtime-protocol-authority.types.js";

/** Prisma transaction unit that interprets runtime command lifecycle and approval markers. */
export class PrismaRuntimeCommandDecisionUnitOfWork implements RuntimeCommandDecisionUnitOfWork
{
	/** Exact dispatch transaction holding the run, assignment, and command-stream fences. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind command lifecycle reads and expiry to the caller-owned dispatch transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Apply server-owned approval deadlines while command polling owns a waiting run fence. */
	async expireWaiting(context: { readonly runId: string; readonly attempt: number; readonly runState: RuntimeAdmissionRunState }, approvalExpiry: RuntimeApprovalExpiry | null, now: Date): Promise<"not_required" | "applied" | "unavailable">
	{
		if (context.runState !== "waiting_for_approval") return "not_required";
		if (approvalExpiry === null) return "unavailable";
		await approvalExpiry.expireInTransaction(this._transaction, { runId: context.runId, attempt: context.attempt, now });
		return "applied";
	}

	/**
	 * Choose the next command from durable state and marker evidence.
	 *
	 * Start and cancel are unique. The first resume may carry approval or steering. Later resumes
	 * require a fresh approval marker, proving another WaitingForApproval cycle completed; steering
	 * alone cannot supersede an active executor loop.
	 */
	async decide(context: { readonly runId: string; readonly attempt: number; readonly runState: RuntimeAdmissionRunState }, commands: readonly { readonly kind: RuntimeCommandKind }[]): Promise<RuntimeCommandKind | null>
	{
		const hasStart = commands.some(function _IsStart(row) { return row.kind === RuntimeCommandKind.StartAttempt; });
		if (context.runState === "cancelling") return commands.some(function _IsCancel(row) { return row.kind === RuntimeCommandKind.CancelAttempt; }) ? null : RuntimeCommandKind.CancelAttempt;
		if ((context.runState === "assigned" || context.runState === "running") && !hasStart) return RuntimeCommandKind.StartAttempt;
		if (context.runState !== "running" || !hasStart) return null;

		const loaded = await new PrismaRuntimeDeferredResumeRepository(this._transaction).load(context.runId, context.attempt, 0);
		if (loaded === null) return null;
		const hasResume = commands.some(function _IsResume(row) { return row.kind === RuntimeCommandKind.ResumeAttempt; });
		return hasResume && loaded.approvalIds.length === 0 ? null : RuntimeCommandKind.ResumeAttempt;
	}
}
