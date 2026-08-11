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
	/** Optional malware-scanner router, present only when its isolated worker plane is enabled. */
	readonly artifactScanner: Router | null;
	/** Optional router that enforces replay policy; the controller decides whether it is mounted. */
	readonly conversationReplay: Router | null;
	/** Router that resolves a browser channel for a workload-authenticated caller, alongside the replay receiver. */
	readonly channelTargetResolver: Router | null;
	/** Runtime router that binds a workload proof key once. */
	readonly runtimeBootstrap: Router;
	/** Runtime server-sent-event stream and candidate-ingest router. */
	readonly runtimeStream: Router;
}

/** The subset of routers built by the controller-only composition step. */
export type ControllerRuntimeComposition = Pick<
	InternalRuntimeComposition,
	"agentControllerRunDispatch" | "skillWorkloadDispatch"
>;

/** The subset of routers built by the isolated skill-workload composition step. */
export type SkillWorkloadRuntimeComposition = Pick<
	InternalRuntimeComposition,
	"skillWorkloadBootstrap" | "skillAuthoringInput" | "skillAuthoringCompletion"
>;

/** The subset of routers built by the runtime-protocol composition step. */
export type RuntimeProtocolComposition = Pick<InternalRuntimeComposition, "runtimeBootstrap" | "runtimeStream">;

/** The subset of routers built by the optional worker and replay composition step. */
export type OptionalRuntimeComposition = Pick<InternalRuntimeComposition, "artifactPreprocessor" | "artifactScanner" | "channelTargetResolver" | "conversationReplay">;
