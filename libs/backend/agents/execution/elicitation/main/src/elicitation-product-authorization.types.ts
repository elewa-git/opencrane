import type { JsonValue } from "@opencrane/util";

/** Central product decisions required by browser-facing elicitation operations. */
export interface ElicitationProductAuthorization
{
	/** Requires Conversation/Read for one current Principal and conversation. */
	canReadConversation(siloId: string, subjectId: string, conversationId: string, now: Date): Promise<boolean>;
	/** Filters conversation ids through the Principal's current Conversation/Read grants. */
	filterReadableConversationIds(siloId: string, subjectId: string, conversationIds: readonly string[], now: Date): Promise<ReadonlySet<string>>;
	/** Admits Conversation/Use and optional exact ApprovalRequest/Decide before a response write. */
	admitResponse(siloId: string, subjectId: string, conversationId: string, approvalRequestId: string | null, response: JsonValue, now: Date): Promise<boolean>;
}
