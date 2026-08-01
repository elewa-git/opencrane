import type { PersonalConfigurationMaterializationPersistenceResult } from "../personal-configuration-materialization.types.js";

/**
 * Internal lock-stage outcomes for the proposal-before-service materialization procedure.
 *
 * These values never leave the materialization module. They make its control-flow boundary explicit:
 * only a ready lock may acquire the service lock, while terminal means a safe replay or refusal.
 */
export enum ProposalLockOutcomes
{
	/** Profile and proposal locks proved a model-selection proposal ready for service processing. */
	Ready = "ready",
	/** Locking reached a final replay/refusal outcome and must not perform later writes. */
	Terminal = "terminal",
}

/** Accepted owner-bound proposal after profile and proposal locks prove its recorded persona head. */
export interface LockedModelSelectionProposal
{
	/** Personal service whose next revision receives the selected model. */
	readonly agentServiceId: string;
	/** Agent revision that must still be the active source revision. */
	readonly expectedAgentRevisionId: string;
	/** Persona revision that must remain active throughout materialization. */
	readonly expectedPersonaRevisionId: string | null;
	/** Normalized public alias selected by the owner. */
	readonly modelAlias: string;
}

/** Successful proposal-lock result, or a terminal outcome that requires no further database work. */
export type ProposalLockResult =
	| { readonly outcome: ProposalLockOutcomes.Ready; readonly proposal: LockedModelSelectionProposal }
	| { readonly outcome: ProposalLockOutcomes.Terminal; readonly result: PersonalConfigurationMaterializationPersistenceResult };
