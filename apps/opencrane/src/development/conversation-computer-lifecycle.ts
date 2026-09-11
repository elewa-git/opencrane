import type { PrismaClient } from "@prisma/client";

import { ConversationComputerHistory, ConversationComputerLifecycleAuthority, ConversationComputerLifecycleDueEnumerator, ConversationComputerLifecycleScheduler, ConversationComputerLifecycleWorker, KurrentConversationComputerActivityReader, PrismaConversationComputerLifecycleProjectionRepository } from "@opencrane/backend/server/conversations";
import type { ConversationComputerRealizer } from "@opencrane/backend/server/conversations";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { ConversationComputerReleaseProfileConfig } from "../app/config.types";
import { _log } from "../app/log";

/** Reuse the current release idle boundaries while keeping the selected lease lifetime explicit. */
const _IDLE_POLICY = { staleAfterMilliseconds: 300_000, retireAfterMilliseconds: 1_200_000 };

/** Start retained-state convergence before the local server accepts traffic, then keep leases current. */
export async function _StartDevelopmentConversationComputerLifecycle(prisma: PrismaClient, historyStore: HistoryStore, realizer: ConversationComputerRealizer, siloId: string, profile: ConversationComputerReleaseProfileConfig): Promise<ConversationComputerLifecycleWorker>
{
	const history = new ConversationComputerHistory(historyStore);
	const projections = new PrismaConversationComputerLifecycleProjectionRepository(prisma);
	const attempts = {
		clearActiveLease: function _ClearActiveLease(command: Parameters<typeof projections.clearActiveLease>[0]) { return ___RunInPrismaUnitOfWork(prisma, function _InTransaction(transaction) { return new PrismaConversationComputerLifecycleProjectionRepository(transaction).clearActiveLease(command); }, { isolationLevel: "Serializable", operation: "development conversation computer active lease clear" }); },
		extendActiveLease: function _ExtendActiveLease(command: Parameters<typeof projections.extendActiveLease>[0]) { return ___RunInPrismaUnitOfWork(prisma, function _InTransaction(transaction) { return new PrismaConversationComputerLifecycleProjectionRepository(transaction).extendActiveLease(command); }, { isolationLevel: "Serializable", operation: "development conversation computer active lease renewal" }); },
	};
	const activity = new KurrentConversationComputerActivityReader(historyStore);
	const policy = { ..._IDLE_POLICY, leaseTtlMilliseconds: profile.leaseTtlMilliseconds };
	const checkpoints = { async capture(): Promise<null> { return null; } };
	const authority = new ConversationComputerLifecycleAuthority(history, checkpoints, attempts, realizer, activity, policy);
	const enumerator = new ConversationComputerLifecycleDueEnumerator(projections, history, activity, realizer, siloId, policy);
	const scheduler = new ConversationComputerLifecycleScheduler(enumerator, authority, 50);
	const initial = await scheduler.reconcileDue(new Date());
	if (initial.includes("active_attempt"))
	{
		throw new Error("Tier 2 retained conversation computer is still fenced by an active attempt");
	}
	return new ConversationComputerLifecycleWorker(scheduler, _log);
}
