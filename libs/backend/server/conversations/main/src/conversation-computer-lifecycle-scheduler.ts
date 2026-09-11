import { createHash } from "node:crypto";

import type { ConversationComputerLifecycleCandidate, ConversationComputerLifecycleEnumerator, ConversationComputerLifecycleReconciler } from "./conversation-computer-lifecycle-scheduler.types";
import type { ConversationComputerLifecycleOutcome } from "./conversation-computer-lifecycle.types";

/** Enumerates projection hints while making Kurrent history the final lifecycle authority. */
export class ConversationComputerLifecycleScheduler
{
	/** Binds one bounded projection enumerator to the authoritative reconciler. */
	public constructor(private readonly candidates: ConversationComputerLifecycleEnumerator, private readonly reconciler: ConversationComputerLifecycleReconciler, private readonly limit: number)
	{
		if (!Number.isSafeInteger(limit) || limit <= 0)
			throw new Error("Conversation computer lifecycle scheduler requires a positive limit");
	}

	/** Drains every stable projection page and reconciles due candidates with retry-stable event ids. */
	public async reconcileDue(now: Date): Promise<readonly ConversationComputerLifecycleOutcome[]>
	{
		if (Number.isNaN(now.getTime()))
			throw new Error("Conversation computer lifecycle scheduler requires a valid server time");
		const outcomes: ConversationComputerLifecycleOutcome[] = [];
		let cursor: string | null = null;
		do
		{
			const page = await this.candidates.enumerateDue(now, this.limit, cursor);
			outcomes.push(...await Promise.all(page.items.map((candidate) => this.reconciler.reconcile({ ...candidate, now, eventId: _LifecycleEventId(candidate) }))));
			if (page.nextCursor !== null && page.nextCursor === cursor)
				throw new Error("Conversation computer lifecycle enumeration did not advance its cursor");
			cursor = page.nextCursor;
		}
		while (cursor !== null);
		return outcomes;
	}
}

/** Derive one retry-stable UUID from the state transition boundary selected by the projection. */
export function _LifecycleEventId(candidate: ConversationComputerLifecycleCandidate): string
{
	const bytes = Buffer.from(createHash("sha256").update([candidate.computer.computerId, candidate.state, candidate.deadline.toISOString()].join("\u0000"), "utf8").digest().subarray(0, 16));
	bytes[6] = (bytes[6]! & 0x0f) | 0x50;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
