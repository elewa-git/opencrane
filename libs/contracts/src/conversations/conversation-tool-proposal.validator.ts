import { z } from "zod";
import { ___CanonicalizeJson, type JsonValue } from "@opencrane/util";

import type { ConversationToolProposal } from "./conversation-tool-proposal.types";

/** Reject excessive nesting before recursive schema or canonical JSON processing. */
function _BoundedArguments(value: unknown): boolean
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return false;
	const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
	let visited = 0;
	while (pending.length > 0)
	{
		const current = pending.pop()!;
		if (++visited > 8_192 || current.depth > 16)
			return false;
		if (current.value === null || typeof current.value === "string" || typeof current.value === "boolean")
			continue;
		if (typeof current.value === "number" && Number.isFinite(current.value))
			continue;
		if (typeof current.value !== "object")
			return false;
		for (const item of Object.values(current.value))
			pending.push({ value: item, depth: current.depth + 1 });
	}
	try
	{
		return new TextEncoder().encode(___CanonicalizeJson(value as JsonValue)).byteLength <= 65_536;
	}
	catch
	{
		return false;
	}
}

/**
 * Bounds JSON arguments shared by tool proposals and their participant-facing approval bodies.
 * This checks size and shape; the IAM owner separately decides whether arguments may be disclosed.
 */
export const ___ConversationToolArgumentsSchema: z.ZodType<ConversationToolProposal["arguments"]> = z.custom<ConversationToolProposal["arguments"]>(_BoundedArguments);

/** Validates a tool selection; the server supplies and checks its authority coordinates. */
export const ___ConversationToolProposalSchema: z.ZodType<ConversationToolProposal> = z.object({
	bootstrapId: z.string().uuid(),
	toolRevisionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/u),
	arguments: ___ConversationToolArgumentsSchema,
}).strict();
