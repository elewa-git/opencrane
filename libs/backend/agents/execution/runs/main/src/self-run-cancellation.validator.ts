import { z } from "zod";

import type { SelfRunCancellationBody } from "./self-run-cancellation.types.js";

/** Strict cancellation body; extra fields cannot smuggle alternate owner or run authority. */
const _SelfRunCancellationBodySchema = z.object({
	expectedAttempt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

/** Parses the cancellation request body, rejecting anything malformed rather than converting it. */
export function _ParseSelfRunCancellationBody(value: unknown): SelfRunCancellationBody | null
{
	const parsed = _SelfRunCancellationBodySchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
