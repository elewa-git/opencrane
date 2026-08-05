// This validator is the browser-body trust boundary, so the transport model and accepted fields evolve together.
import { z } from "zod";

import type { PersonalRunAdmissionRequestBody } from "./personal-run-admission.router.types.js";

/** Strict bounded schema that refuses caller-supplied authority coordinates and empty identifiers. */
const _PersonalRunAdmissionRequestBodySchema: z.ZodType<PersonalRunAdmissionRequestBody> = z.object({
	threadId: z.string().trim().min(1).max(200),
	requestIdempotencyKey: z.string().trim().min(1).max(200),
}).strict();

/** Parse the exact personal-run browser body, returning null for every malformed or forged shape. */
export function _ParsePersonalRunAdmissionRequestBody(value: unknown): PersonalRunAdmissionRequestBody | null
{
	const parsed = _PersonalRunAdmissionRequestBodySchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
