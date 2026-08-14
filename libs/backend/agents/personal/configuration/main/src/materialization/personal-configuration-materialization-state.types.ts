import type { PersonalConfigurationMaterializationPersistenceResult } from "./personal-configuration-materialization.types";

/** Proposal states, spelled out here so this package does not depend on Prisma's generated enum. */
export enum PersonalConfigurationMaterializationLifecycleStates
{
	/** The owner has not yet accepted or rejected the proposal. */
	Proposed = "proposed",
	/** The owner accepted the proposal, so it may be materialised. */
	Accepted = "accepted",
	/** The proposal already produced the stored immutable revision. */
	Applied = "applied",
	/** The owner explicitly rejected the proposal. */
	Rejected = "rejected",
	/** A newer authoritative change replaced this proposal. */
	Superseded = "superseded",
}

/**
 * Whether a proposal may be materialised, or already has its final answer.
 *
 * `Ready` means the caller should go on and create the revision. `Terminal` means the answer is
 * already decided — a repeat of an earlier apply, or a refusal — and the caller must return it
 * without writing anything. Treating `Terminal` as `Ready` would create a second revision for a
 * proposal that was already applied.
 */
export enum PersonalConfigurationMaterializationResolutionOutcomes
{
	/** The proposal is a model-alias change and may be materialised. */
	Ready = "ready",
	/** The result is already decided — a repeat of an earlier apply, or a refusal — so write nothing more. */
	Terminal = "terminal",
}

/**
 * An accepted proposal that passed its checks and is ready to become a revision.
 *
 * Only produced once the owner's currently active persona revision has been re-read and still
 * matches what the proposal recorded. The two `expected*` fields are passed on to
 * agent-services, which re-checks them itself when it creates the revision.
 */
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

/**
 * Either a proposal ready to materialise, or a final result that needs no more work.
 *
 * Returned by {@link PersonalConfigurationMaterializationRepository.resolve} and by every patch
 * strategy. A `Terminal` value must be returned to the caller unchanged — it is already the
 * answer. See {@link PersonalConfigurationMaterializationResolutionOutcomes}.
 */
export type PersonalConfigurationMaterializationResolution =
	| { readonly outcome: PersonalConfigurationMaterializationResolutionOutcomes.Ready; readonly proposal: MaterializableModelSelectionProposal }
	| { readonly outcome: PersonalConfigurationMaterializationResolutionOutcomes.Terminal; readonly result: PersonalConfigurationMaterializationPersistenceResult };

/** The stored proposal fields needed to read its state. */
export interface PersonalConfigurationMaterializationLifecycleChange
{
	/** Current durable proposal lifecycle state. */
	readonly state: PersonalConfigurationMaterializationLifecycleStates;
	/** Revision stored by a completed materialisation, when one exists. */
	readonly appliedAgentRevisionId: string | null;
}

/**
 * The stored proposal fields a materialisation strategy reads.
 *
 * `requestedPatch` is typed `unknown` on purpose: it comes back from a JSON column and must be
 * validated with `_IsPersonalConfigurationPatch` before anything reads its fields. A patch that
 * fails that check is refused as `NotApplicable` rather than trusted.
 */
export interface PersonalConfigurationMaterializationChange extends PersonalConfigurationMaterializationLifecycleChange
{
	/** Persona profile whose active revision must still match expectedPersonaRevisionId. */
	readonly personaProfileId: string;
	/** Personal service that gets the new revision. */
	readonly agentServiceId: string;
	/** Persona revision recorded when the owner reviewed this proposal. */
	readonly expectedPersonaRevisionId: string | null;
	/** Service revision recorded when the owner reviewed this proposal. */
	readonly expectedAgentRevisionId: string | null;
	/** The stored patch, as read from the database and not yet validated. */
	readonly requestedPatch: unknown;
}

/** The next action selected by the proposal lifecycle state machine. */
export enum PersonalConfigurationMaterializationLifecycleOutcomes
{
	/** The proposal is accepted, so its strategy may run. */
	Materialize = "materialize",
	/** The state already decides the result: a repeat of an earlier apply, or a refusal. */
	Terminal = "terminal",
}

/** What reading the proposal's state produced, before anything is written. */
export type PersonalConfigurationMaterializationLifecycleResult =
	| { readonly outcome: PersonalConfigurationMaterializationLifecycleOutcomes.Materialize }
	| { readonly outcome: PersonalConfigurationMaterializationLifecycleOutcomes.Terminal; readonly result: PersonalConfigurationMaterializationPersistenceResult };
