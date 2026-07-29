import type { PersonalConfigurationMaterializationPersistenceResult } from "../personal-configuration-materialization.types.js";

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
	| { readonly outcome: "ready"; readonly proposal: LockedModelSelectionProposal }
	| { readonly outcome: "terminal"; readonly result: PersonalConfigurationMaterializationPersistenceResult };
