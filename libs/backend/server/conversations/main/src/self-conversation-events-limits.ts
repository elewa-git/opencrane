import type { ConversationEventSubjectBudget, SelfConversationEventLimits } from "./self-conversation-events.types";

/** Resolves fixed connection budgets and rejects invalid composition before serving requests. */
export function _ConversationEventLimits(overrides: Partial<SelfConversationEventLimits> = {}): SelfConversationEventLimits
{
	const limits = { durationMs: 60_000, idleMs: 30_000, heartbeatMs: 10_000, drainMs: 5_000, eventBytes: 524_288, responseBytes: 2_097_152, eventCount: 128, subjectConnections: 2, subjectStartsPerMinute: 12, totalConnections: 128, subjects: 10_000, ...overrides };
	if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 1))
		throw new Error("Conversation event limits must be positive integers");
	return limits;
}

/** Creates bounded per-subject admission in this process; multiple replicas each enforce their own budget. */
export function _CreateConversationEventAdmission(limits: SelfConversationEventLimits): (subjectKey: string) => (() => void) | null
{
	const subjects = new Map<string, ConversationEventSubjectBudget>();
	let total = 0;
	return function _Admit(subjectKey)
	{
		const now = Date.now();
		for (const [key, budget] of subjects)
			if (budget.active === 0 && now - budget.windowStartedAt >= 60_000)
				subjects.delete(key);
		let budget = subjects.get(subjectKey);
		if (budget === undefined)
		{
			if (subjects.size >= limits.subjects)
				return null;
			budget = { active: 0, starts: 0, windowStartedAt: now };
			subjects.set(subjectKey, budget);
		}
		if (now - budget.windowStartedAt >= 60_000)
		{
			budget.starts = 0;
			budget.windowStartedAt = now;
		}
		if (total >= limits.totalConnections || budget.active >= limits.subjectConnections || budget.starts >= limits.subjectStartsPerMinute)
			return null;
		budget.active += 1;
		budget.starts += 1;
		total += 1;
		let released = false;
		return function _Release()
		{
			if (released)
				return;
			released = true;
			budget.active -= 1;
			total -= 1;
		};
	};
}
