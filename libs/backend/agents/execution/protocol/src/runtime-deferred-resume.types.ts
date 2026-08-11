import type { ResumeAttemptCommand } from "@opencrane/contracts";

/** Durable resume body plus the exact marker rows consumed after command persistence. */
export interface RuntimeDeferredResumeLoad
{
	/** Exact runtime resume body authorized by terminal approval and steering rows. */
	readonly resume: ResumeAttemptCommand;
	/** Approval ids whose single-use markers belong to this body. */
	readonly approvalIds: string[];
	/** Steering ids whose pending state belongs to this body. */
	readonly steeringRequestIds: string[];
}

/** Transaction-scoped marker loader used by command dispatch without exposing Prisma delegates. */
export interface RuntimeDeferredResumeRepository
{
	/** Load one exact run attempt's resumable results and steering rows. */
	load(runId: string, attempt: number, inputGeneration: number): Promise<RuntimeDeferredResumeLoad | null>;
}

/** Transaction binding that constructs the exact marker repository for dispatch. */
export interface RuntimeDeferredResumeUnitOfWork
{
	/** Load marker rows on the already-open dispatch transaction. */
	load(runId: string, attempt: number, inputGeneration: number): Promise<RuntimeDeferredResumeLoad | null>;
}
