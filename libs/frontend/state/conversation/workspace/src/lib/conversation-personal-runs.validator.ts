// The generated API response enters browser state here; keep its validator beside the public model.
import { z } from "zod";

import { ___RunToolProgressSchema } from "@opencrane/contracts";

import type { ConversationPersonalRun } from "./conversation-personal-runs.types";

/** Accepts exactly the generated current run states and bounded public status fields. */
const _Run: z.ZodType<ConversationPersonalRun> = z.object({ runId: z.string().min(1).max(256), attempt: z.number().int().positive(), state: z.enum(["accepted", "queued", "assigned", "running", "waiting_for_input", "recovery_required", "completed", "failed"]), conversationId: z.string().min(1).max(256).nullable(), agentRevisionId: z.string().min(1).max(256), acceptedAt: z.string().datetime({ offset: true }), latestTool: ___RunToolProgressSchema.nullable(),
	finishedAt: z.string().datetime({ offset: true }).nullable() }).strict();
/** Rejects malformed envelopes and duplicate run identities before state adoption. */
const _Runs = z.object({ runs: z.array(_Run).max(50) }).strict().refine(value => new Set(value.runs.map(run => run.runId)).size === value.runs.length);

/** Validates the public recent-work response; callers must still filter it to their selected chat. */
export function _ParseConversationPersonalRuns(value: unknown): readonly ConversationPersonalRun[] { return _Runs.parse(value).runs; }
