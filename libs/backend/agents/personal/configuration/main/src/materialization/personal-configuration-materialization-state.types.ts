import type { PersonalConfigurationMaterializationPersistenceResult } from "./personal-configuration-materialization.types.js";

/** Personal-configuration lifecycle vocabulary detached from Prisma's generated client. */
export enum PersonalConfigurationMaterializationLifecycleStates
{
	/** The owner has not yet accepted or rejected the proposal. */
	Proposed = "proposed",
	/** The owner accepted the immutable proposal and it may enter its strategy. */
	Accepted = "accepted",
	/** The proposal already produced the stored immutable revision. */
	Applied = "applied",
	/** The owner explicitly rejected the proposal. */
	Rejected = "rejected",
	/** A newer authoritative change replaced this proposal. */
	Superseded = "superseded",
}

/** Internal outcomes from classifying lifecycle state and patch strategy evidence. */
export enum PersonalConfigurationMaterializationResolutionOutcomes
{
	/** Proposal evidence permits the agent-service model-alias materialisation strategy. */
	Ready = "ready",
	/** Resolution reached a final replay or refusal outcome and must not perform later writes. */
	Terminal = "terminal",
}

/** Accepted owner-bound proposal after a strategy proves its recorded persona head. */
export interface MaterializableModelSelectionProposal
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
export type PersonalConfigurationMaterializationResolution =
	| { readonly outcome: PersonalConfigurationMaterializationResolutionOutcomes.Ready; readonly proposal: MaterializableModelSelectionProposal }
	| { readonly outcome: PersonalConfigurationMaterializationResolutionOutcomes.Terminal; readonly result: PersonalConfigurationMaterializationPersistenceResult };

/** Persisted proposal fields used solely to interpret its materialisation lifecycle. */
export interface PersonalConfigurationMaterializationLifecycleChange
{
	/** Current durable proposal lifecycle state. */
	readonly state: PersonalConfigurationMaterializationLifecycleStates;
	/** Revision stored by a completed materialisation, when one exists. */
	readonly appliedAgentRevisionId: string | null;
}

/** Persisted proposal evidence consumed by its selected patch-kind materialisation strategy. */
export interface PersonalConfigurationMaterializationChange extends PersonalConfigurationMaterializationLifecycleChange
{
	/** Persona profile whose active revision must still match the proposal evidence. */
	readonly personaProfileId: string;
	/** Personal service whose immutable revision may be extended. */
	readonly agentServiceId: string;
	/** Persona revision recorded when the owner reviewed this proposal. */
	readonly expectedPersonaRevisionId: string | null;
	/** Service revision recorded when the owner reviewed this proposal. */
	readonly expectedAgentRevisionId: string | null;
	/** Closed patch value persisted with immutable source provenance. */
	readonly requestedPatch: unknown;
}

/** The next action selected by the proposal lifecycle state machine. */
export enum PersonalConfigurationMaterializationLifecycleOutcomes
{
	/** An accepted proposal may enter its patch-kind materialisation strategy. */
	Materialize = "materialize",
	/** The lifecycle already determines a replay or refusal result. */
	Terminal = "terminal",
}

/** Result of interpreting a persisted proposal lifecycle before any cross-domain write. */
export type PersonalConfigurationMaterializationLifecycleResult =
	| { readonly outcome: PersonalConfigurationMaterializationLifecycleOutcomes.Materialize }
	| { readonly outcome: PersonalConfigurationMaterializationLifecycleOutcomes.Terminal; readonly result: PersonalConfigurationMaterializationPersistenceResult };
