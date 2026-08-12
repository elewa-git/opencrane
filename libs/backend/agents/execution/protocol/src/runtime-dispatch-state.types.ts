/** The saved invocation fields needed to check that a repeated candidate matches the first one. */
export interface RuntimeDispatchToolInvocation
{
	/** Runtime process that originally proposed the invocation. */
	readonly runtimeInstanceId: string;
	/** Command frame under which the invocation was proposed. */
	readonly commandId: string;
	/** Immutable tool revision selected by the runtime. */
	readonly toolRevisionId: string;
	/** Public invocation id used in runtime and conversation events. */
	readonly toolInvocationId: string;
	/** Digest of the originally proposed argument object. */
	readonly argumentsDigest: string;
	/** Request fingerprint saved when the candidate was first accepted. */
	readonly requestFingerprint: string;
}

/**
 * Reads and writes the dispatch rows that live outside the command stream, on the caller's
 * transaction.
 *
 * Two unrelated-looking jobs share this port because both must commit with the command or
 * candidate decision that triggered them: consuming a resume command's tool-result rows, and
 * reading back a saved invocation to check a repeated candidate.
 *
 * Called by: `_nextCommand` and `_admitCandidate` in prisma-runtime-dispatch-authority.ts.
 * Implemented by `PrismaRuntimeDispatchStateRepository`.
 */
export interface RuntimeDispatchStateRepository
{
	/** Mark consumed the pending result rows carried by one saved resume command. */
	consumeToolResultDeliveries(deliveryIds: readonly string[], consumedAt: Date): Promise<void>;
	/** Load the saved invocation fields for a candidate that is being sent again. */
	findToolInvocation(runId: string, attempt: number, candidateId: string): Promise<RuntimeDispatchToolInvocation | null>;
}

/** The same operations, but it builds the repository itself from the caller's transaction. */
export interface RuntimeDispatchStateUnitOfWork extends RuntimeDispatchStateRepository {}
