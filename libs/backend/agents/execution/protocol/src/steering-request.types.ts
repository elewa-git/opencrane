import type { JsonValue } from "@opencrane/util";

/** Server-derived request to queue one owner's instruction for the current run attempt. */
export interface SubmitSteeringRequestCommand
{
	/** Logical run selected by the public path. */
	readonly runId: string;
	/** Silo resolved from the authenticated request host. */
	readonly siloId: string;
	/** Stable authenticated subject that must own the run. */
	readonly subjectId: string;
	/** Bounded JSON instruction accepted from the owner. */
	readonly content: JsonValue;
	/** Server-computed canonical digest of the accepted instruction. */
	readonly digest: string;
	/** Trusted submission instant. */
	readonly submittedAt: Date;
}

/** Stable result of attempting to queue steering for the live run attempt. */
export type SubmitSteeringRequestResult =
	| { readonly outcome: "queued"; readonly steeringRequestId: string; readonly attempt: number }
	| { readonly outcome: "not_found_or_not_owner" }
	| { readonly outcome: "run_not_steerable" };

/** Atomic product-authority boundary for owner-submitted runtime steering. */
export interface SteeringRequestRepository
{
/** Queue a request only for the authenticated owner's current attempt before its sole resume command. */
	submitAtomically(command: SubmitSteeringRequestCommand): Promise<SubmitSteeringRequestResult>;
}
