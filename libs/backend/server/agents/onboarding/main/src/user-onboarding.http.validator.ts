// This validator is the owner-answer browser-body trust boundary, so its model and accepted fields evolve together.
import { z } from "zod";

import type { SubmitUserOnboardingAnswerCommand } from "./user-onboarding-chat.types.js";

/** Strict schema for one bounded answer fenced to the exact projected conversation question. */
const _UserOnboardingAnswerBodySchema: z.ZodType<SubmitUserOnboardingAnswerCommand> = z.object({
	expectedConversationId: z.string().trim().min(1).max(128),
	expectedQuestionOrdinal: z.number().int().min(1).max(3),
	text: z.string().min(1).max(4000),
	idempotencyKey: z.string().min(1).max(128),
}).strict();

/** Parse the exact answer body, returning null for malformed, forged, or out-of-bounds input. */
export function _ParseUserOnboardingAnswerBody(value: unknown): SubmitUserOnboardingAnswerCommand | null
{
	const parsed = _UserOnboardingAnswerBodySchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
