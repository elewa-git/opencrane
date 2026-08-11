/** Minimal durable invocation evidence required to validate one replayed runtime candidate. */
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
	/** Complete request fingerprint persisted at first admission. */
	readonly requestFingerprint: string;
}

/** Transaction-bound repository for runtime dispatch state owned outside the command stream. */
export interface RuntimeDispatchStateRepository
{
	/** Consume the exact pending result deliveries included in one durable resume command. */
	consumeToolResultDeliveries(deliveryIds: readonly string[], consumedAt: Date): Promise<void>;
	/** Load immutable invocation evidence for one idempotently replayed candidate. */
	findToolInvocation(runId: string, attempt: number, candidateId: string): Promise<RuntimeDispatchToolInvocation | null>;
}

/** Transaction owner that keeps runtime dispatch repository construction behind one boundary. */
export interface RuntimeDispatchStateUnitOfWork extends RuntimeDispatchStateRepository {}
