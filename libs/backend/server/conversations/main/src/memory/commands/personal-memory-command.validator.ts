import { z } from "zod";
import { PersonalMemoryOperationKinds } from "@opencrane/backend/agents/personal/memory";

import type { PersonalMemoryCommand } from "./personal-memory-command.types";

/** Keeps public coordinates bounded and rejects normalization that would change command identity. */
const _Identifier = z.string().min(1).max(128).refine(function _IsCanonical(value) { return value === value.trim(); });
/** Binds a bounded read to the requested immutable message, without accepting encrypted payload fields. */
const _Source = z.object({ conversationId: _Identifier, messageId: _Identifier, messagePosition: z.string().refine(function _FitsDatabasePosition(value)
{
	if (value.length > 19 || !/^[1-9][0-9]*$/u.test(value))
		return false;
	return BigInt(value) <= 9_223_372_036_854_775_807n;
}) }).strict();
/** Defines the exact optimistic revision requested for an existing fact. */
const _Target = { targetFactId: _Identifier, expectedFactRevision: z.number().int().positive().max(2_147_483_647) } as const;

/** Rejects plaintext, authority claims and provider coordinates before command preparation. */
export const _PersonalMemoryCommandSchema: z.ZodType<PersonalMemoryCommand> = z.discriminatedUnion("kind", [
	z.object({ commandId: z.string().uuid(), kind: z.literal(PersonalMemoryOperationKinds.Remember), source: _Source }).strict(),
	z.object({ commandId: z.string().uuid(), kind: z.literal(PersonalMemoryOperationKinds.Correct), source: _Source, ..._Target }).strict(),
	z.object({ commandId: z.string().uuid(), kind: z.literal(PersonalMemoryOperationKinds.Forget), ..._Target }).strict(),
]);
