import type { GroupChildCreateCommand, GroupChildShareCommand, GroupChildView } from "@opencrane/models/conversations";
import type { ConversationAsset, ReserveConversationAssetUpload } from "@opencrane/state/conversation/assets";
import type { ConversationWorkspaceDetail, CreateConversationCommand, SubmitConversationMessageCommand } from "@opencrane/state/conversation/workspace";

/** Records an accepted creation command and the conversation it established for later retries. */
export interface _LocalDevelopmentConversationReceipt
{
	/** Preserves the creation command bound to the retry key. */
	readonly command: CreateConversationCommand;
	/** Identifies the conversation created by the accepted command. */
	readonly conversationId: ConversationWorkspaceDetail["id"];
}

/** Records the participant message accepted for a conversation-scoped retry key. */
export interface _LocalDevelopmentMessageReceipt
{
	/** Preserves the message command accepted into local history. */
	readonly command: SubmitConversationMessageCommand;
}

/** Records an accepted reservation and the file coordinate it established for later retries. */
export interface _LocalDevelopmentAssetReceipt
{
	/** Identifies the conversation that scopes the reservation key. */
	readonly conversationId: string;
	/** Preserves the reservation request bound to the retry key. */
	readonly request: ReserveConversationAssetUpload;
	/** Identifies the file created by the accepted reservation. */
	readonly assetId: ConversationAsset["id"];
}

/** Records an accepted group-child command and the child projection it established for later retries. */
export interface _LocalDevelopmentGroupChildReceipt
{
	/** Identifies the parent group that scopes the accepted request. */
	readonly parentConversationId: string;
	/** Preserves the child-creation command bound to the retry key. */
	readonly command: GroupChildCreateCommand;
	/** Preserves the child projection created by the accepted request. */
	readonly child: GroupChildView;
}

/** Records the reviewed share accepted for a parent-scoped retry key. */
export interface _LocalDevelopmentGroupShareReceipt
{
	/** Identifies the child whose reviewed result supplied the share. */
	readonly childConversationId: string;
	/** Identifies the parent group that owns the appended human message. */
	readonly parentConversationId: string;
	/** Preserves the reviewed-share command bound to the retry key. */
	readonly command: GroupChildShareCommand;
}
