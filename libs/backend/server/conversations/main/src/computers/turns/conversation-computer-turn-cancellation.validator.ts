import { z } from "zod";

import type { ConversationComputerTurnCancellationReceipt } from "./conversation-computer-turn.types";

/** Rejects malformed private cancellation events before they become a terminal turn decision. */
export const _ConversationComputerTurnCancellationReceiptSchema: z.ZodType<ConversationComputerTurnCancellationReceipt> = z.object({ commandId: z.string().uuid(), commandDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u), occurredAt: z.string().datetime({ offset: true }) }).strict();
