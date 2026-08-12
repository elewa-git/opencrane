import type { Router } from "express";

import type { SkillWorkloadBootstrapIdentity, SkillWorkloadBootstrapLogger, SkillWorkloadBootstrapTokenReviewer } from "./skill-workload-bootstrap.types.js";
import type { SkillAuthoringCompletionAuthority } from "./skill-workload-authority.types.js";

/** Stable terminal outcomes accepted from an isolated skill-authoring worker. */
export enum SkillAuthoringCompletionOutcomes
{
	/** The worker supplied both bounded passing reports. */
	Succeeded = "succeeded",
	/** The worker sent a short failure code and nothing else. */
	Failed = "failed",
}

/** Result of the checks run against one draft skill revision. */
export interface SkillAuthoringCheckReport
{
	/** Whether every check in this report passed. */
	readonly passed: boolean;
	/** Short worker-produced explanation suitable for later human review. */
	readonly summary: string;
	/** Number of individual checks represented by the report. */
	readonly checksRun: number;
}

/** The completion report an authoring worker may send. It cannot name an identity or a workload class. */
export type SkillAuthoringCompletionCommand =
	| {
		/** Id of the authoring workload, chosen before its Job was unsuspended. */
		readonly workloadId: string;
		/** Marks this as a success. Both reports must be present. */
		readonly outcome: SkillAuthoringCompletionOutcomes.Succeeded;
		/** Test evidence to persist on the draft SkillRevision. */
		readonly testReport: SkillAuthoringCheckReport;
		/** Scan evidence to persist on the draft SkillRevision. */
		readonly scanResult: SkillAuthoringCheckReport;
	}
	| {
		/** Id of the authoring workload, chosen before its Job was unsuspended. */
		readonly workloadId: string;
		/** Marks this as a failure. Only the failure code is stored, never worker output. */
		readonly outcome: SkillAuthoringCompletionOutcomes.Failed;
		/** Stable server-recognised failure code, never a worker stack trace. */
		readonly failureCode: string;
	};

/** Dependencies of the worker-authenticated authoring completion route. */
export interface SkillAuthoringCompletionRouterDependencies
{
	/** Reviews the worker's projected token against the route-owned authoring audience. */
	readonly tokenReviewer: SkillWorkloadBootstrapTokenReviewer;
	/** Writes the final state and the two reports to the database. */
	readonly authority: SkillAuthoringCompletionAuthority;
	/** Logs database failures, and nothing sensitive. */
	readonly logger: SkillWorkloadBootstrapLogger;
}

/** Factory producing the authoring-only worker completion route. */
export type CreateSkillAuthoringCompletionRouter = (dependencies: SkillAuthoringCompletionRouterDependencies) => Router;
