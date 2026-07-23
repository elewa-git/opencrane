import type { ConversationUserInputRepository, SubmitConversationUserInputCommand, SubmitConversationUserInputResult } from "./conversation-authority.types.js";

/** Persist one user message and every exact artifact input through the single atomic conversation boundary. */
export async function __SubmitConversationUserInput(repository: ConversationUserInputRepository, command: SubmitConversationUserInputCommand): Promise<SubmitConversationUserInputResult>
{
	if (!_isCommandValid(command)) return { outcome: "denied", reason: "invalid_command" };
	const result = await repository.submitAtomically(command);
	return result.status === "submitted" ? { outcome: "submitted" } : { outcome: "denied", reason: result.status };
}

/** Validate opaque coordinates and prohibit an empty message that carries neither text nor an attachment. */
function _isCommandValid(command: SubmitConversationUserInputCommand): boolean
{
	const hasValidCoordinates = [command.messageId, command.siloId, command.threadId, command.userId].every(function _identifier(value): boolean { return value.trim().length > 0 && value.length <= 200; });
	const uniqueAttachments = new Set(command.artifactRevisionIds);
	return hasValidCoordinates
		&& command.text.length <= 100_000
		&& (command.text.trim().length > 0 || command.artifactRevisionIds.length > 0)
		&& uniqueAttachments.size === command.artifactRevisionIds.length
		&& command.artifactRevisionIds.every(function _artifactId(value): boolean { return value.trim().length > 0 && value.length <= 200; });
}
