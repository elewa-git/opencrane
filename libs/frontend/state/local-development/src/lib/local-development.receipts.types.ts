import type { GroupChildCreateCommand, GroupChildShareCommand, GroupChildView } from "@opencrane/models/conversations";
import type { ConversationAsset, ReserveConversationAssetUpload } from "@opencrane/state/conversation/assets";
import type { ConversationWorkspaceDetail, CreateConversationCommand, SubmitConversationMessageCommand } from "@opencrane/state/conversation/workspace";

/** Accepted creation input and the stable conversation it established. */
export interface _LocalDevelopmentConversationReceipt
{
	/** Immutable creation command bound to the retry key. */
	readonly command: CreateConversationCommand;
	/** Stable conversation coordinate created by the command. */
	readonly conversationId: ConversationWorkspaceDetail["id"];
}

/** Accepted participant message bound to its conversation-scoped retry key. */
export interface _LocalDevelopmentMessageReceipt
{
	/** Immutable message command accepted into local history. */
	readonly command: SubmitConversationMessageCommand;
}

/** Accepted reservation input and the stable file coordinate it established. */
export interface _LocalDevelopmentAssetReceipt
{
	/** Conversation that scopes the reservation key. */
	readonly conversationId: string;
	/** Immutable reservation request bound to the retry key. */
	readonly request: ReserveConversationAssetUpload;
	/** Stable file coordinate created by the reservation. */
	readonly assetId: ConversationAsset["id"];
}

/** Accepted group-child input and the stable request projection it established. */
export interface _LocalDevelopmentGroupChildReceipt
{
	/** Parent group that scopes the admitted request. */
	readonly parentConversationId: string;
	/** Immutable child-creation command bound to the retry key. */
	readonly command: GroupChildCreateCommand;
	/** Stable child projection created by the request. */
	readonly child: GroupChildView;
}

/** Accepted reviewed share bound to its parent-scoped retry key. */
export interface _LocalDevelopmentGroupShareReceipt
{
	/** Child whose reviewed result supplied the share. */
	readonly childConversationId: string;
	/** Parent group that owns the appended human message. */
	readonly parentConversationId: string;
	/** Immutable reviewed share bound to the retry key. */
	readonly command: GroupChildShareCommand;
}
