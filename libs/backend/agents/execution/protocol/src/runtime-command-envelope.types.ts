import type { CancelAttemptCommand, CompiledRunInput } from "@opencrane/contracts";

import type { StoredRuntimeResumeInput } from "./runtime-resume-input.types";

/** Extra data for one command body, built only from data that cannot change. */
export interface RuntimeCommandExtras
{
	/** The compiled input a `start_attempt` command needs. */
	readonly compiledInput: CompiledRunInput | null;
	/** The approved tool results a `resume_attempt` command needs. */
	readonly resume: StoredRuntimeResumeInput | null;
	/** Tool-result rows this resume command marks consumed once it is saved. */
	readonly resumeToolResultDeliveryIds: readonly string[];
	/** Elicitation-result rows this resume frame consumes when minted. */
	readonly resumeElicitationResultDeliveryIds: readonly string[];
	/** Steering rows consumed only after their enclosing resume command is persisted. */
	readonly resumeSteeringRequestIds: readonly string[];
	/** Server-defined stop reason carried by a `cancel_attempt` frame. */
	readonly cancelReason: CancelAttemptCommand["reason"];
}
