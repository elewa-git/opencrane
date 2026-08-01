import type { Router } from "express";

import type { SkillWorkloadBootstrapIdentity, SkillWorkloadBootstrapLogger, SkillWorkloadBootstrapTokenReviewer } from "./skill-workload-bootstrap.types.js";

/** Bounded evidence from the isolated checks performed against one draft skill revision. */
export interface SkillAuthoringCheckReport
{
	/** Whether every check in this report passed. */
	readonly passed: boolean;
	/** Short worker-produced explanation suitable for later human review. */
	readonly summary: string;
	/** Number of individual checks represented by the report. */
	readonly checksRun: number;
}

/** One exact authoring-worker terminal report with no caller-selected identity or workload class. */
export type SkillAuthoringCompletionCommand =
	| {
		/** Durable authoring workload selected before its worker Job was released. */
		readonly workloadId: string;
		/** Records a completed candidate validation with both required reports. */
		readonly outcome: "succeeded";
		/** Test evidence to persist on the draft SkillRevision. */
		readonly testReport: SkillAuthoringCheckReport;
		/** Scan evidence to persist on the draft SkillRevision. */
		readonly scanResult: SkillAuthoringCheckReport;
	}
	| {
		/** Durable authoring workload selected before its worker Job was released. */
		readonly workloadId: string;
		/** Records a terminal worker failure without accepting unbounded output. */
		readonly outcome: "failed";
		/** Stable server-recognised failure code, never a worker stack trace. */
		readonly failureCode: string;
	};

/** Postgres boundary for one authoring worker's exact terminal transition and evidence write. */
export interface SkillAuthoringCompletionRepository
{
	/** Completes only the released, canonical-worker-Pod, bootstrap-consumed authoring workload. */
	completeAtomically(command: SkillAuthoringCompletionCommand, identity: SkillWorkloadBootstrapIdentity): Promise<"completed" | "conflict">;
}

/** Dependencies of the worker-authenticated authoring completion route. */
export interface SkillAuthoringCompletionRouterDependencies
{
	/** Reviews the worker's projected token against the route-owned authoring audience. */
	readonly tokenReviewer: SkillWorkloadBootstrapTokenReviewer;
	/** Executes the one terminal state and evidence transition against Postgres. */
	readonly repository: SkillAuthoringCompletionRepository;
	/** Emits only structured, non-sensitive authority failures. */
	readonly logger: SkillWorkloadBootstrapLogger;
}

/** Factory producing the authoring-only worker completion route. */
export type CreateSkillAuthoringCompletionRouter = (dependencies: SkillAuthoringCompletionRouterDependencies) => Router;
