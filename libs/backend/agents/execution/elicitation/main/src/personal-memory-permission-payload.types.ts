import type { z } from "zod";

import type { PersonalMemoryPermissionPayloadSchema } from "./personal-memory-permission-payload.validator.js";

/** Protected coordinates inferred from the one canonical trust-boundary validator. */
export type PersonalMemoryPermissionPayload = z.infer<typeof PersonalMemoryPermissionPayloadSchema>;

/** Receipt fields compared with a protected personal-memory purpose payload. */
export type PersonalMemoryPermissionReceiptCoordinates = {
	/** Invocation authorized by the receipt. */
	readonly toolInvocationId: string;
	/** Invocation revision authorized by the receipt. */
	readonly toolInvocationRevision: number;
	/** Run authorized by the receipt. */
	readonly runId: string;
	/** Run attempt authorized by the receipt. */
	readonly attempt: number;
	/** User whose personal memory may be read. */
	readonly executionSubjectId: string;
	/** Digest of the admitted memory query. */
	readonly queryDigest: string;
	/** Digest of the frozen run input. */
	readonly inputSnapshotDigest: string;
	/** Persona revision used by the run. */
	readonly personaRevisionId: string;
	/** Time after which the receipt no longer grants access. */
	readonly expiresAt: Date;
};
