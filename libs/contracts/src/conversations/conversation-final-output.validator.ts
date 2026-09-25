import { z } from "zod";
import { ___CanonicalizeJson } from "@opencrane/util";

import type { ConversationFinalOutput } from "./conversation-final-output.types";
import { ___ConversationA2uiDisplaySchema } from "./conversation-a2ui.validator";

// A final model response becomes a named answer only through this strict schema. It preserves
// text, refuses extra fields and leaves graph completeness and conversation authority to the owner.

/** Checks valid Unicode and the answer byte limit without changing surrounding whitespace. */
function _validText(value: string): boolean
{
	try
	{
		___CanonicalizeJson(value);
		return value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 65_536;
	}
	catch { return false; }
}

/** Shares unchanged ordinary-text acceptance between literal mode and conversation envelopes. */
export const ___ConversationFinalTextSchema = z.string().max(65_536).refine(_validText);
/** Validates a conversation answer without making malformed display content silently disappear. */
export const ___ConversationFinalOutputSchema: z.ZodType<ConversationFinalOutput> = z.object({ text: ___ConversationFinalTextSchema, display: ___ConversationA2uiDisplaySchema.optional() }).strict();
