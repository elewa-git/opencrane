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
