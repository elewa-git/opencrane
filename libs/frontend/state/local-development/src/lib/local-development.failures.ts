import { ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds } from "@opencrane/state/conversation/workspace";

/** Reports that a retry key is already bound to another immutable local command. */
export function _LocalDevelopmentConflict(): never
{
	throw new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Conflict, "This local command key is already bound to different coordinates. Review the current state before retrying.");
}

/** Reports that a requested local conversation coordinate is not currently available. */
export function _LocalDevelopmentAccessChanged(): never
{
	throw new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.AccessChanged, "This local conversation is no longer available.");
}

/** Reports that a conversation-owned local resource coordinate is unavailable. */
export function _LocalDevelopmentUnavailable(): never
{
	throw new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Unavailable, "The requested local conversation resource is unavailable.");
}
