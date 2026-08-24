/** The fields that Absurd returns after admitting one task. */
export interface AbsurdSpawnReceipt
{
	/** Stable engine task identity. */
	readonly taskId: string;
	/** Engine run identity for the admitted attempt. */
	readonly runId: string;
	/** Positive attempt number selected by Absurd. */
	readonly attempt: number;
	/** Whether this call admitted a new task rather than finding its idempotency match. */
	readonly created: boolean;
}

/** A transaction-bound task admission request before the contract maps it to its public receipt. */
export interface AbsurdSpawnRequest
{
	/** Registered Absurd task name. */
	readonly taskName: string;
	/** Deterministic duplicate-prevention key from the caller. */
	readonly idempotencyKey: string;
	/** JSON-compatible input delivered to the registered task. */
	readonly input: unknown;
	/** Attempt limit that Absurd stores with this task. */
	readonly maximumAttempts: number;
	/** Absurd-native retry delay stored with this task. */
	readonly retryStrategy: {
		readonly kind: "fixed" | "exponential";
		readonly baseSeconds: number;
		readonly factor?: number;
		readonly maxSeconds?: number;
	};
}

/**
 * Executes the one engine-owned database procedure needed to admit a durable task.
 *
 * Called by: `AbsurdDurableExecution` through `PrismaDbProcedureGateway`. The caller supplies
 * its existing product transaction; implementations must not open, commit, or roll back one.
 */
export interface AbsurdTaskAdmissionProcedure
{
	/** Call the fixed Absurd admission procedure with a typed parameter map. */
	___DbProcedureCall(transactionClient: unknown, request: AbsurdSpawnRequest): Promise<AbsurdSpawnReceipt>;
}
