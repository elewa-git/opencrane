import type { V1Job } from "@kubernetes/client-node";

import type { AgentControllerSkillWorkloadAssignmentCommand, AgentControllerSkillWorkloadClaim } from "@opencrane/contracts";
import type { SkillWorkloadJobProfile } from "@opencrane/backend/agents/skills/k8s-launcher";
import type { Logger } from "@opencrane/observability";

/** Immutable profile map keyed by the one permitted governed skill workload class. */
export type SkillWorkloadControllerProfiles = Readonly<Record<AgentControllerSkillWorkloadClaim["kind"], SkillWorkloadJobProfile>>;

/** OpenCrane operations available to the outbound-only governed-skill controller. */
export interface SkillWorkloadControllerAuthority
{
	/** Claim one database-fenced pending workload, or return null when no work is ready. */
	__Claim(signal: AbortSignal): Promise<AgentControllerSkillWorkloadClaim | null>;
	/** Atomically bind the exact Kubernetes Job UID to the claimed workload generation. */
	__CommitAssignment(workloadId: string, command: AgentControllerSkillWorkloadAssignmentCommand, signal: AbortSignal): Promise<"assigned" | "idempotent" | "conflict">;
}

/** Kubernetes operation permitted to the skill controller reconciliation. */
export interface SkillWorkloadControllerKubernetesStore
{
	/** Create or exact-adopt one deterministic still-suspended governed skill Job. */
	__EnsureSuspendedJob(expected: V1Job): Promise<V1Job>;
}

/** Fetch-compatible function injected into the internal HTTP authority adapter. */
export type SkillWorkloadControllerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Rotating projected-token reader injected into the internal HTTP authority adapter. */
export type SkillWorkloadControllerTokenReader = () => Promise<string>;

/** Configuration for the projected-token-authenticated governed skill authority adapter. */
export interface SkillWorkloadControllerHttpAuthorityOptions
{
	/** Internal OpenCrane base URL with no path, query, or credentials. */
	readonly openCraneInternalUrl: string;
	/** Absolute path of the rotating projected controller token. */
	readonly tokenPath: string;
	/** Hard timeout for one HTTP exchange. */
	readonly requestTimeoutMilliseconds: number;
	/** Optional fetch seam used by focused tests. */
	readonly fetch?: SkillWorkloadControllerFetch;
	/** Optional rotating-token seam used by focused tests. */
	readonly readToken?: SkillWorkloadControllerTokenReader;
}

/** Fixed policy and adapters for one governed skill workload reconciliation. */
export interface SkillWorkloadControllerOptions
{
	/** Authenticated desired-state and assignment authority. */
	readonly authority: SkillWorkloadControllerAuthority;
	/** Least-privilege Kubernetes creation and exact-adoption adapter. */
	readonly kubernetes: SkillWorkloadControllerKubernetesStore;
	/** Deployment-owned profiles for the only two governed workload classes. */
	readonly profiles: SkillWorkloadControllerProfiles;
	/** Delay after an idle poll or a handled reconciliation failure. */
	readonly pollIntervalMilliseconds: number;
	/** Process-wide structured logger. */
	readonly log: Logger;
}

/** Result of one controller desired-state poll. */
export type SkillWorkloadControllerReconcileResult =
	| { readonly outcome: "idle" }
	| { readonly outcome: "assigned" | "idempotent"; readonly workloadId: string; readonly workloadUid: string };
