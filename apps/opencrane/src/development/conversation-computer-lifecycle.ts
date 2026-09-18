import type { PrismaClient } from "@prisma/client";

import { PrismaConversationRunLifecycleUnitOfWork } from "@opencrane/backend/agents/execution/runs";
import { ConversationComputerHistory, ConversationComputerLifecycleAuthority, ConversationComputerLifecycleDueEnumerator, ConversationComputerLifecycleScheduler, ConversationComputerLifecycleWorker, KurrentConversationComputerActivityReader, KurrentConversationComputerTurnStore, PrismaConversationComputerLifecycleProjectionRepository } from "@opencrane/backend/server/conversations";
import type { ConversationComputerCredentialIssuer, ConversationComputerRealizer, FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { ___ExecutionSubjectSchema } from "@opencrane/contracts";

import type { ConversationComputerReleaseProfileConfig } from "../app/config.types";
import { _log } from "../app/log";

/** Reuse the current release idle boundaries while keeping the selected lease lifetime explicit. */
const _IDLE_POLICY = { staleAfterMilliseconds: 300_000, retireAfterMilliseconds: 1_200_000 };

/** Report that Tier 2 has no external lifecycle checkpoint to capture. */
async function _CaptureCheckpoint(): Promise<null> { return null; }

/** Resolve lease-loss against the same durable answer slot before changing SQL run state. */
export async function _ResolveDevelopmentConversationComputerTurn(turn: FrozenConversationComputerTurn, turnStore: Pick<KurrentConversationComputerTurnStore, "markUnavailable" | "recoverOutput" | "settle">, runs: Pick<PrismaConversationRunLifecycleUnitOfWork, "complete" | "fail">, credentials: Pick<ConversationComputerCredentialIssuer, "revoke">): Promise<void>
{
	const winner = turn.outputReceipt === null ? await turnStore.markUnavailable(turn.bootstrapId) : turn;
	const command = { runId: winner.compile.runId, siloId: winner.siloId, attempt: winner.compile.attempt, computerId: winner.computerId, lease: winner.lease };
	if (winner.outputReceipt !== null)
	{
		await turnStore.recoverOutput(winner);
		await runs.complete(command);
		await credentials.revoke(winner.bootstrapId);
		await turnStore.settle(winner);
		return;
	}
	await credentials.revoke(winner.bootstrapId);
	await runs.fail(command);
	await turnStore.settle(winner);
}

/** Start retained-state convergence before the local server accepts traffic, then keep leases current. */
export async function _StartDevelopmentConversationComputerLifecycle(prisma: PrismaClient, historyStore: HistoryStore, realizer: ConversationComputerRealizer, credentials: Pick<ConversationComputerCredentialIssuer, "revoke">, siloId: string, profile: ConversationComputerReleaseProfileConfig): Promise<ConversationComputerLifecycleWorker>
{
	const history = new ConversationComputerHistory(historyStore);
	const projections = new PrismaConversationComputerLifecycleProjectionRepository(prisma);
	const turnStore = new KurrentConversationComputerTurnStore(historyStore);
	const runs = new PrismaConversationRunLifecycleUnitOfWork(prisma);

	/** Close one no-longer-runnable turn only after its provider credential is revoked. */
	async function _FailTurn(turn: FrozenConversationComputerTurn): Promise<void>
	{
		await _ResolveDevelopmentConversationComputerTurn(turn, turnStore, runs, credentials);
	}

	/** Recover runs stranded by an older server after their admitted lease was already replaced. */
	async function _RecoverReplacedLeaseRuns(): Promise<void>
	{
		const activeRuns = await projections.listActiveRuns(siloId);
		for (const run of activeRuns)
		{
			const subject = ___ExecutionSubjectSchema.safeParse(run.executionSubject);
			if (!subject.success || subject.data.runScope.runId !== run.id || subject.data.runScope.attempt !== run.attempt)
				throw new Error("Tier 2 retained conversation run has invalid execution authority");
			const computer = subject.data.computerScope;
			if (await projections.hasActiveLease(siloId, computer.computerId, { leaseId: computer.leaseId, leaseGeneration: computer.leaseGeneration }))
				continue;
			const turn = await turnStore.loadActive({ siloId, computerId: computer.computerId, lease: { leaseId: computer.leaseId, leaseGeneration: computer.leaseGeneration } });
			if (turn !== null)
			{
				if (turn.compile.runId !== run.id || turn.compile.attempt !== run.attempt)
					throw new Error("Tier 2 retained conversation turn does not match its active run");
				await _FailTurn(turn);
				continue;
			}
			await runs.fail({ runId: run.id, siloId, attempt: run.attempt, computerId: computer.computerId, lease: { leaseId: computer.leaseId, leaseGeneration: computer.leaseGeneration } });
		}
	}

	/** Clear the active lease inside the database transaction that owns the projection write. */
	function _ClearActiveLease(command: Parameters<typeof projections.clearActiveLease>[0])
	{
		return (async function _RecoverThenClear()
		{
			const turn = await turnStore.loadActive({ siloId: command.computer.siloId, computerId: command.computer.computerId, lease: command.lease });
			if (turn !== null)
				await _FailTurn(turn);
			return ___RunInPrismaUnitOfWork(prisma, function _InTransaction(transaction)
			{
				const repository = new PrismaConversationComputerLifecycleProjectionRepository(transaction);

				return turn === null ? repository.failUnfrozenRunAndClearActiveLease(command) : repository.clearActiveLease(command);
			}, {
				isolationLevel: "Serializable",
				operation: "development conversation computer active lease clear",
			});
		})();
	}

	/** Extend the active lease inside the database transaction that owns the projection write. */
	function _ExtendActiveLease(command: Parameters<typeof projections.extendActiveLease>[0])
	{
		return ___RunInPrismaUnitOfWork(prisma, function _InTransaction(transaction)
		{
			const repository = new PrismaConversationComputerLifecycleProjectionRepository(transaction);

			return repository.extendActiveLease(command);
		}, {
			isolationLevel: "Serializable",
			operation: "development conversation computer active lease renewal",
		});
	}

	const attempts = {
		clearActiveLease: _ClearActiveLease,
		extendActiveLease: _ExtendActiveLease,
	};
	const activity = new KurrentConversationComputerActivityReader(historyStore);
	const policy = { ..._IDLE_POLICY, leaseTtlMilliseconds: profile.leaseTtlMilliseconds };
	const checkpoints = { capture: _CaptureCheckpoint };
	const authority = new ConversationComputerLifecycleAuthority(history, checkpoints, attempts, realizer, activity, policy);
	const enumerator = new ConversationComputerLifecycleDueEnumerator(projections, history, activity, realizer, siloId, policy);
	const scheduler = new ConversationComputerLifecycleScheduler(enumerator, authority, 50);
	await _RecoverReplacedLeaseRuns();
	const initial = await scheduler.reconcileDue(new Date());
	if (initial.includes("active_attempt"))
	{
		throw new Error("Tier 2 retained conversation computer is still fenced by an active attempt");
	}

	return new ConversationComputerLifecycleWorker(scheduler, _log);
}
