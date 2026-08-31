import { z } from "zod";

/** Public route-parameter schema for one OCI image validation identifier. */
export const ___OciImageValidationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);

/** Public request schema for one OCI image validation submission. */
export const ___OciImageValidationSubmissionSchema = z.object({
	idempotencyKey: z.string().trim().min(1).max(128),
	artifactId: ___OciImageValidationIdSchema,
	artifactRevisionId: ___OciImageValidationIdSchema,
}).strict();
