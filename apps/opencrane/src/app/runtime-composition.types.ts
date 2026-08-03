import type { Router } from "express";

import type { PrismaRunDispatchRepository } from "@opencrane/backend/agents/execution/runs";
import type { PrismaRuntimeDispatchAuthority } from "@opencrane/backend/agents/execution/protocol";
import type { RuntimeBootstrapClock } from "@opencrane/backend/server/iam/authorization";
import type { RuntimeIdentityNamespaces, RuntimeTokenReviewer, SkillWorkloadTokenReviewer } from "@opencrane/server/_infra/workload-identity";

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

/** Validated namespace coordinates used to bind workload identity and runtime bootstrap. */
export interface InternalRuntimeIdentity
{
	/** Namespace containing the OpenCrane server and agent controller. */
	readonly serverNamespace: string;
	/** Namespace reserved for personal runtime Jobs. */
	readonly personalRuntimeNamespace: string;
	/** Namespace reserved for managed runtime Jobs. */
	readonly managedRuntimeNamespace: string;
}

/** Shared reviewed identities and durable authorities used by all internal runtime routes. */
export interface InternalRuntimeAuthorities
{
	/** Token reviewer restricted to the controller ServiceAccount and server namespace. */
	readonly controllerTokenReviewer: ReturnType<typeof import("@opencrane/server/_infra/workload-identity")._CreateAgentControllerTokenReviewer>;
	/** Token reviewer that validates the skill worker audience and Pod identity. */
	readonly skillWorkloadTokenReviewer: SkillWorkloadTokenReviewer;
	/** Token reviewer that distinguishes personal and managed runtime planes. */
	readonly runtimeTokenReviewer: RuntimeTokenReviewer;
	/** Durable authority for controller run dispatch and release fencing. */
	readonly runDispatchRepository: PrismaRunDispatchRepository;
	/** Durable authority for runtime command admission and external-action execution. */
	readonly runtimeDispatchAuthority: PrismaRuntimeDispatchAuthority;
}

/** Runtime-plane namespaces used by the TokenReview and bootstrap authorities. */
export type InternalRuntimePlanes = Pick<RuntimeIdentityNamespaces, "personalRuntimeNamespace" | "managedRuntimeNamespace">;

/** Clock supplied to the runtime bootstrap router. */
export type InternalRuntimeClock = RuntimeBootstrapClock;
