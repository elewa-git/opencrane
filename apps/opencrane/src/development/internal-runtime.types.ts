import type { Router } from "express";

/** Routers needed by the Tier 2 Agent profiles. */
export interface DevelopmentInternalRuntimeComposition
{
	/** Lets the local controller claim, assign, and release admitted run attempts. */
	readonly agentRunWorkflowController: Router;
	/** Binds an authenticated warm runtime to one ready assignment. */
	readonly warmRuntimeBinding: Router;
	/** Carries commands and validated runtime candidates over the normal runtime protocol. */
	readonly warmRuntimeStream: Router;
	/** Delivers a child Agent thread result to its parent conversation when that flow is used. */
	readonly agentThreadParentDeliveries: Router;
}
