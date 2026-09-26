import type { RoutineStatus } from "@opencrane/models/agents";

/** Commands that interpret the durable routine lifecycle. */
export enum RoutineLifecycleEvent
{
	/** Replaces schedule and ciphertext with a new immutable revision. */
	Revise = "revise",
	/** Stops future automatic occurrence selection. */
	Pause = "pause",
	/** Restarts automatic selection from the database time of this command. */
	Resume = "resume",
	/** Permanently closes every future occurrence command. */
	Retire = "retire",
	/** Requests an immediate occurrence without moving the automatic cursor. */
	RunNow = "run_now",
	/** Handles the durable task for the next scheduled wake. */
	AutomaticWake = "automatic_wake",
}

/** Closed outcome returned by the lifecycle table before persistence applies other guards. */
export enum RoutineLifecycleDecisionKind
{
	/** The command may continue through requester, authorization, and compare-and-set checks. */
	Proceed = "proceed",
	/** The command has no effect in this state and must not write. */
	NoOp = "no_op",
	/** The manual request is saved as refused so retries recover the same result. */
	Refuse = "refuse",
}

/** One cell in the routine State by Event table. */
export interface RoutineLifecycleDecision
{
	/** Says whether persistence may continue or must stop. */
	readonly kind: RoutineLifecycleDecisionKind;
	/** Status to save when the command commits. */
	readonly nextStatus: RoutineStatus;
}
