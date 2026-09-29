import { ___RequestRoutineSuggestionSchema } from "@opencrane/backend/server/agents/scheduling/contract";
import { ___CanonicalizeJson, ___DigestCanonicalJson, ___ParseAndValidateJson, type JsonValue } from "@opencrane/util";

/** Parse only scheduling-owned suggestion fields from the provider declaration. */
export function _ParseConversationRequestRoutineSuggestion(argumentsJson: string)
{
	return ___ParseAndValidateJson(argumentsJson, "request_routine arguments", value => ___RequestRoutineSuggestionSchema.parse(value));
}

/** Produce the private, content-free result returned to the model after proposal persistence. */
export function _ConversationRequestRoutineResult(proposalRef: string, expiresAt: string): { readonly resultContent: string; readonly resultDigest: string }
{
	const receipt = { outcome: "ready_for_review", proposalRef, expiresAt } as const;
	return { resultContent: ___CanonicalizeJson(receipt as unknown as JsonValue), resultDigest: ___DigestCanonicalJson(receipt as unknown as JsonValue) };
}
