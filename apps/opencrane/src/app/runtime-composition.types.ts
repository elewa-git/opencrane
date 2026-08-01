import type { Router } from "express";

/**
 * Named workload-facing routers composed by the OpenCrane process.
 *
 * The type deliberately carries no paths. `routes.ts` owns the visible transport map, while the
 * composition module owns the concrete identity reviewers, repositories, and external-I/O ports.
 */
export interface InternalRuntimeComposition
{
	/** Controller-only router for claiming and committing run attempts. */
	readonly agentControllerRunDispatch: Router;
	/** Controller-only router for governed skill workload dispatch. */
	readonly skillWorkloadDispatch: Router;
	/** Runtime router for one-use workload bootstrap claims. */
	readonly skillWorkloadBootstrap: Router;
	/** Runtime router for reading fenced skill-authoring input. */
	readonly skillAuthoringInput: Router;
	/** Runtime router for committing fenced skill-authoring completion. */
	readonly skillAuthoringCompletion: Router;
	/** Optional preprocessor router, present only when the restricted worker plane is enabled. */
	readonly artifactPreprocessor: Router | null;
	/** Optional controller-selected replay policy enforcement point. */
	readonly conversationReplay: Router | null;
	/** Runtime router that binds a workload proof key once. */
	readonly runtimeBootstrap: Router;
	/** Runtime server-sent-event stream and candidate-ingest router. */
	readonly runtimeStream: Router;
}

/** Controller-only composition slice. */
export type ControllerRuntimeComposition = Pick<InternalRuntimeComposition, "agentControllerRunDispatch" | "skillWorkloadDispatch">;

/** Isolated skill workload composition slice. */
export type SkillWorkloadRuntimeComposition = Pick<InternalRuntimeComposition, "skillWorkloadBootstrap" | "skillAuthoringInput" | "skillAuthoringCompletion">;

/** Runtime protocol composition slice. */
export type RuntimeProtocolComposition = Pick<InternalRuntimeComposition, "runtimeBootstrap" | "runtimeStream">;

/** Optional workload and replay composition slice. */
export type OptionalRuntimeComposition = Pick<InternalRuntimeComposition, "artifactPreprocessor" | "conversationReplay">;
