/**
 * Formats an authority-backed pending count for visible and accessible workspace actions.
 *
 * Called by: `ConversationListComponent` and `ConversationWorkspaceHeaderComponent` so their
 * visible count and accessible names cannot drift apart.
 *
 * @param count - Current pending-question count from the activity store.
 * @returns Plain singular or plural copy without adding notification lifecycle semantics.
 */
export function _PendingQuestionLabel(count: number): string { return count === 1 ? "1 question needs your response" : `${count} questions need your response`; }
