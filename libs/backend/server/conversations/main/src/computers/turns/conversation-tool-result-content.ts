import { ___CanonicalizeJson, type JsonValue } from "@opencrane/util";

import { ConversationGeneratedFileResultStates } from "../tools/results/conversation-generated-file-result.types";
import { ConversationComputerToolResultOutcomes, type ConversationComputerToolResult } from "./conversation-computer-continuation.types";

/**
 * Adds the saved publication outcome to a generated tool result before model continuation.
 * The invocation's original payload and digest remain unchanged. The complete projected content
 * is saved in encrypted continuation custody and compared again before the model request.
 */
export function _ConversationToolResultContent(result: Extract<ConversationComputerToolResult, { outcome: ConversationComputerToolResultOutcomes.Available }>): string
{
	const file = result.generatedFile;
	if (file === undefined)
		return ___CanonicalizeJson(result.payload);
	const publication: JsonValue = file.state === ConversationGeneratedFileResultStates.Ready
		? { state: file.state, name: file.artifact.name, mediaType: file.artifact.mediaType }
		: { state: file.state, failureCode: file.failureCode };
	return ___CanonicalizeJson({ toolResult: result.payload, filePublication: publication });
}
