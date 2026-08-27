import type { Router } from "express";

/**
 * Named workload-facing routers composed by the OpenCrane process.
 *
 * The type deliberately carries no paths. `routes.ts` owns the visible transport map, while the
 * composition module owns the concrete identity reviewers, repositories, and external-I/O ports.
 *
 * The `Pick` aliases below exist so each composition step declares the routers it builds and can
 * return nothing else. A step that accidentally built a router with another caller plane's token
 * reviewer would have to name it in its own return type first.
 *
 * Called by: `_CreateInternalRuntimeComposition` in runtime-composition.ts builds it, and
 * `_RegisterInternalRoutes` in routes.ts mounts every router in it.
 */
export interface InternalRuntimeComposition
{
	/** Controller-only router that serves one durable AgentRun workflow task. */
	readonly agentRunWorkflowController: Router;
	/** Controller-only router for governed skill workload dispatch. */
	readonly skillWorkloadDispatch: Router;
	/** Runtime router for one-use workload bootstrap claims. */
	readonly skillWorkloadBootstrap: Router;
	/** Runtime router for reading fenced skill-authoring input. */
	readonly skillAuthoringInput: Router;
	/** Runtime router for committing fenced skill-authoring completion. */
	readonly skillAuthoringCompletion: Router;
	/** Optional controller router for task-bound PDF preprocessing Jobs. */
	readonly artifactPreprocessController: Router | null;
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
	/** Runtime-only broker for generated conversation-file output. */
	readonly conversationAssetOutputs: Router;
	/**
	 * Runtime-only router that accepts one display-safe delivery from an Agent-thread child up to its
	 * parent group message.
	 *
	 * A run inside a child conversation reports its result, question, or failure back to the parent
	 * through this route, so the parent summary can change without the browser being trusted to say what
	 * a run produced. It stays out of every browser router on purpose: only a workload whose Kubernetes
	 * ServiceAccount token passes TokenReview may produce a delivery.
	 * @see AgentThreadParentDeliveryUnitOfWork for the port behind it and its denial reasons.
	 */
	readonly agentThreadParentDeliveries: Router;
}

/** The subset of routers built by the controller-only composition step. */
export type ControllerRuntimeComposition = Pick<
	InternalRuntimeComposition,
	"agentRunWorkflowController" | "skillWorkloadDispatch"
>;

/** The subset of routers built by the isolated skill-workload composition step. */
export type SkillWorkloadRuntimeComposition = Pick<
	InternalRuntimeComposition,
	"skillWorkloadBootstrap" | "skillAuthoringInput" | "skillAuthoringCompletion"
>;

/** The subset of routers built by the runtime-protocol composition step. */
export type RuntimeProtocolComposition = Pick<InternalRuntimeComposition, "runtimeBootstrap" | "runtimeStream" | "conversationAssetOutputs" | "agentThreadParentDeliveries">;

/** The subset of routers built by the optional worker and replay composition step. */
export type OptionalRuntimeComposition = Pick<InternalRuntimeComposition, "artifactPreprocessController" | "artifactPreprocessor" | "artifactScanner" | "channelTargetResolver" | "conversationReplay">;
