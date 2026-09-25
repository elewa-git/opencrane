/**
 * Reuses the conversation owner's current sharing rules for an ordinary shared question.
 * Elicitation still checks its purpose, membership, participation and central Read/Use permission.
 * This port grants no invitation, inherited parent access or protected-action approval.
 */
export interface ElicitationConversationAccess
{
	/** Refuses a child whose saved audience or shared parent source no longer permits this reader. */
	canAccess(siloId: string, subjectId: string, conversationId: string): Promise<boolean>;
}

/** Builds the sharing check from the same transaction that reads or resolves the question. */
export type ElicitationConversationAccessFactory = (transaction: object) => ElicitationConversationAccess;
