import { CompiledFinalOutputModes, ConversationModelResponseKinds, ___ConversationFinalOutputSchema, ___ConversationModelResponseSchema, type ConversationFinalOutput, type ConversationModelResponse } from "@opencrane/contracts";
import { ___ParseAndValidateJson } from "@opencrane/util";

import { ConversationModelError, ConversationModelFailureCodes } from "./conversation-model.types";

/**
 * Decodes final content according to the output mode captured before the model request.
 * Literal mode never interprets JSON-looking answers. Envelope errors expose no provider content.
 * @throws ConversationModelError when content is invalid for the admitted format.
 */
export function _DecodeConversationModelFinalOutput(content: unknown, mode: CompiledFinalOutputModes): ConversationModelResponse
{
	try
	{
		switch (mode)
		{
			case CompiledFinalOutputModes.Text:
				return ___ConversationModelResponseSchema.parse({ kind: ConversationModelResponseKinds.Text, text: content });
			case CompiledFinalOutputModes.Conversation:
			{
				if (typeof content !== "string")
					throw new ConversationModelError(ConversationModelFailureCodes.UnsupportedResponse);
				const answer = ___ParseAndValidateJson(content, "Conversation final output", _validateEnvelope);
				return { kind: ConversationModelResponseKinds.Text, ...answer };
			}
			default:
				throw new ConversationModelError(ConversationModelFailureCodes.UnsupportedResponse);
		}
	}
	catch
	{
		throw new ConversationModelError(ConversationModelFailureCodes.UnsupportedResponse);
	}
}

/** Delegates the domain shape without retaining parser diagnostics or unknown extension fields. */
function _validateEnvelope(candidate: unknown): ConversationFinalOutput
{
	return ___ConversationFinalOutputSchema.parse(candidate);
}
