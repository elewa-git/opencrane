import type { PersonalConfigurationMaterializationPersistenceResult } from "../personal-configuration-materialization.types.js";

/** Internal outcomes from resolving a proposal and its persona evidence. */
export enum ProposalResolutionOutcomes
{
	/** Proposal evidence and the serializable persona snapshot permit service processing. */
	Ready = "ready",
	/** Resolution reached a final replay/refusal outcome and must not perform later writes. */
	Terminal = "terminal",
}

/** Accepted owner-bound proposal after the serializable read proves its recorded persona head. */
interface MaterializableModelSelectionProposal
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

/** Resolved proposal ready for materialization, or a terminal outcome requiring no further work. */
export type ProposalResolutionResult =
	| { readonly outcome: ProposalResolutionOutcomes.Ready; readonly proposal: MaterializableModelSelectionProposal }
	| { readonly outcome: ProposalResolutionOutcomes.Terminal; readonly result: PersonalConfigurationMaterializationPersistenceResult };
