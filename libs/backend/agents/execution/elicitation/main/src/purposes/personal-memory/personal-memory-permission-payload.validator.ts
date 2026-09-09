import { z } from "zod";

/** Persisted protected purpose payload; parse it again at the Prisma trust boundary. */
export const PersonalMemoryPermissionPayloadSchema = z.object({
	toolInvocationId: z.string().min(1),
	toolInvocationRevision: z.number().int().nonnegative(),
	runId: z.string().min(1),
	attempt: z.number().int().positive(),
	executionSubjectId: z.string().min(1),
	queryDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
	inputSnapshotDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
	personaRevisionId: z.string().min(1),
	expiresAt: z.string().datetime({ offset: true }),
}).strict();

/** Parse persisted JSON without allowing missing, additional, or substituted coordinates. */
export function _ParsePersonalMemoryPermissionPayload(value: unknown): z.infer<typeof PersonalMemoryPermissionPayloadSchema> | null
{
	const parsed = PersonalMemoryPermissionPayloadSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
