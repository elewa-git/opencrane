import type { PrismaClient } from "@prisma/client";

import { ConversationComputerLifecycleAuthority, ConversationComputerLifecycleDueEnumerator, ConversationComputerLifecycleScheduler, ConversationComputerLifecycleWorker, KurrentConversationComputerActivityReader, PrismaConversationComputerLifecycleProjectionRepository, PrismaConversationComputerLifecycleUnitOfWork, type ConversationComputerRealizer } from "@opencrane/backend/server/conversations";
import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ConversationComputerReleaseProfileConfig } from "../configuration/config.types";
import { _log } from "../process/log";

/** Reuse the current release idle boundaries while keeping the selected lease lifetime explicit. */
const _IDLE_POLICY = { staleAfterMilliseconds: 300_000, retireAfterMilliseconds: 1_200_000 };

/** Report that Tier 2 has no external lifecycle checkpoint to capture. */
async function _CaptureCheckpoint(): Promise<null> { return null; }

/** Start realization-neutral lifecycle reconciliation without a Tier 3 checkpoint surface. */
export async function _StartDevelopmentConversationComputerLifecycle(prisma: PrismaClient, historyStore: HistoryStore, realizer: ConversationComputerRealizer, siloId: string, profile: ConversationComputerReleaseProfileConfig): Promise<ConversationComputerLifecycleWorker>
{
	const history = new ConversationComputerHistory(historyStore);
	const projections = new PrismaConversationComputerLifecycleProjectionRepository(prisma);
	const activity = new KurrentConversationComputerActivityReader(historyStore);
	const policy = { ..._IDLE_POLICY, leaseTtlMilliseconds: profile.leaseTtlMilliseconds };
	const authority = new ConversationComputerLifecycleAuthority(history, { capture: _CaptureCheckpoint }, new PrismaConversationComputerLifecycleUnitOfWork(prisma), realizer, activity, policy);
	const enumerator = new ConversationComputerLifecycleDueEnumerator(projections, history, activity, realizer, siloId, policy);
	const scheduler = new ConversationComputerLifecycleScheduler(enumerator, authority, 50);
	const initial = await scheduler.reconcileDue(new Date());

	if (initial.includes("active_attempt"))
	{
		throw new Error("Tier 2 retained conversation computer is still fenced by an active attempt");
	}

	return new ConversationComputerLifecycleWorker(scheduler, _log);
}
