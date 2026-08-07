import type { Router } from "express";

import type { SkillWorkloadBootstrapIdentity, SkillWorkloadBootstrapLogger, SkillWorkloadBootstrapTokenReviewer } from "./skill-workload-bootstrap.types.js";
import type { SkillAuthoringCompletionAuthority } from "./skill-workload-authority.types.js";

/** Stable terminal outcomes accepted from an isolated skill-authoring worker. */
export enum SkillAuthoringCompletionOutcomes
{
	/** The worker supplied both bounded passing reports. */
	Succeeded = "succeeded",
	/** The worker supplied one stable failure code and no unbounded output. */
	Failed = "failed",
}

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
		readonly outcome: SkillAuthoringCompletionOutcomes.Succeeded;
		/** Test evidence to persist on the draft SkillRevision. */
		readonly testReport: SkillAuthoringCheckReport;
		/** Scan evidence to persist on the draft SkillRevision. */
		readonly scanResult: SkillAuthoringCheckReport;
	}
	| {
		/** Durable authoring workload selected before its worker Job was released. */
		readonly workloadId: string;
		/** Records a terminal worker failure without accepting unbounded output. */
		readonly outcome: SkillAuthoringCompletionOutcomes.Failed;
		/** Stable server-recognised failure code, never a worker stack trace. */
		readonly failureCode: string;
	};

/** Dependencies of the worker-authenticated authoring completion route. */
export interface SkillAuthoringCompletionRouterDependencies
{
	/** Reviews the worker's projected token against the route-owned authoring audience. */
	readonly tokenReviewer: SkillWorkloadBootstrapTokenReviewer;
	/** Executes the one terminal state and evidence transition through its application authority. */
	readonly authority: SkillAuthoringCompletionAuthority;
	/** Emits only structured, non-sensitive authority failures. */
	readonly logger: SkillWorkloadBootstrapLogger;
}

/** Factory producing the authoring-only worker completion route. */
export type CreateSkillAuthoringCompletionRouter = (dependencies: SkillAuthoringCompletionRouterDependencies) => Router;
