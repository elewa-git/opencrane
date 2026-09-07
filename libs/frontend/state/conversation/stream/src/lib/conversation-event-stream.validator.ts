// Authenticated HTTP and SSE bodies remain untrusted until they match the browser history model.
// Strict objects reject extensions; the shared entry and computer schemas own their nested shapes.
import { z } from "zod";

import { ___ConversationComputerSchema, ___ConversationEntrySchema } from "@opencrane/contracts";

import type { ConversationHistoryProjection } from "./conversation-event-stream.types";

/** Accepts decimal positions without precision loss or alternate spellings. */
const _Position = z.string().max(20).regex(/^(0|[1-9][0-9]*)$/u);

/** Checks the complete participant history response before any part enters browser state. */
const _Projection: z.ZodType<ConversationHistoryProjection> = z.object({
	entries: z.array(___ConversationEntrySchema),
	payloads: z.record(z.string(), z.string()),
	nextPosition: _Position,
	computer: ___ConversationComputerSchema.nullable()
}).strict();

/**
 * Checks response identity, ordered entries, and progress relative to the last accepted cursor.
 * Duplicate entries at an already accepted position may replay, but the response cannot move back.
 * @throws Error when the response could mix conversations or skip an entry beyond its checkpoint.
 */
export function __ParseConversationHistoryProjection(value: unknown, conversationId: string, previousPosition: string): ConversationHistoryProjection
{
	const parsed = _Projection.parse(value);
	const nextPosition = BigInt(parsed.nextPosition);
	if (nextPosition < BigInt(_Position.parse(previousPosition)) || (parsed.computer !== null && parsed.computer.conversationId !== conversationId))
		throw new Error("invalid conversation history coordinates");
	let prior = -1n;
	for (const entry of parsed.entries)
	{
		const position = BigInt(_Position.parse(entry.position));
		if (entry.conversationId !== conversationId || position <= prior || position > nextPosition)
			throw new Error("invalid conversation history coordinates");
		prior = position;
	}
	return parsed;
}
