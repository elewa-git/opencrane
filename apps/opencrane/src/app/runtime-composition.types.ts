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
	/** Controller-only router for one admitted skill-authoring validation workflow. */
	readonly skillAuthoringValidationController: Router;
	/** Worker-only protocol for one task-bound Python skill validation Job. */
	readonly skillAuthoringValidationWorker: Router;
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
}

/** The subset of routers built by the controller-only composition step. */
export type ControllerRuntimeComposition = Pick<
	InternalRuntimeComposition,
	"skillAuthoringValidationController"
>;

/** The subset of routers built by the optional worker and replay composition step. */
export type OptionalRuntimeComposition = Pick<InternalRuntimeComposition, "artifactPreprocessController" | "artifactPreprocessor" | "artifactScanner" | "channelTargetResolver" | "conversationReplay">;
