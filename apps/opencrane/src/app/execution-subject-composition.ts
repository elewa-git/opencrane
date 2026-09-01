import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ExecutionSubjectComposition } from "./execution-subject-composition.types";

/**
 * Stops startup until the target execution-subject adapter is available to this composition root.
 *
 * The adapter must join checked AgentIdentity history, current membership and capability evidence,
 * and an active ConversationComputer lease before it returns either authority. ADR 0016 requires
 * admission to recheck those facts in the transaction that seals the snapshot; starting without
 * this adapter would expose an admission or retry path that cannot make that check.
 *
 * Called by: `_Main` in `apps/opencrane/src/index.ts` before route composition.
 *
 * @throws Always, until a concrete target adapter supplies `ExecutionSubjectComposition`.
 * @see `docs/adr/0016-conversation-history-and-computers.md` for the admission rule.
 */
export function _RequireExecutionSubjectComposition(_historyStore: HistoryStore): ExecutionSubjectComposition
{
	throw new Error("OpenCrane 0.11.0 requires an app-owned execution-subject adapter that joins checked AgentIdentity history, current membership and capability evidence, and an active ConversationComputer lease before startup.");
}
