import type { PersonalAgentBootstrapCommand, PersonalAgentBootstrapResult } from "./personal-agent-bootstrap.types";

/**
 * States returned by the app-owned adapter for the initial publication model resolver.
 *
 * Agent-services owns this vocabulary so it does not depend on model-routing. Every state except
 * `Resolved` denies publication before the first AgentService write.
 *
 * Called by: `PrismaInitialPersonalAgentPublicationRepository` and the OpenCrane composition root.
 * @see {@link InitialPersonalAgentDefaultModelResolver}
 */
export enum InitialPersonalAgentDefaultModelResolutionStatuses
{
	/** Model-routing resolved exactly one accessible model definition. */
	Resolved = "resolved",
	/** Model-routing found no configured or accessible model definition. */
	Unavailable = "unavailable",
	/** Model-routing found conflicting rows at the selected precedence rung. */
	Ambiguous = "ambiguous",
}

/** Complete model-resolution result consumed before initial personal-Agent publication. */
export type InitialPersonalAgentDefaultModelResolution =
	| { readonly status: InitialPersonalAgentDefaultModelResolutionStatuses.Resolved; readonly modelDefinitionId: string }
	| { readonly status: InitialPersonalAgentDefaultModelResolutionStatuses.Unavailable }
	| { readonly status: InitialPersonalAgentDefaultModelResolutionStatuses.Ambiguous };

/**
 * Narrow app-provided port for resolving the first personal Agent's configured default model.
 *
 * The app adapts model-routing's transaction-scoped resolver into this contract. Agent-services
 * consumes only the stable definition identity and denial state, never routing persistence.
 *
 * Implemented by: `_CreateInitialPersonalAgentDefaultModelResolver` in
 * `apps/opencrane/src/app/user-onboarding-composition.ts`.
 * Called by: `PrismaInitialPersonalAgentPublicationRepository.publish`.
 */
export interface InitialPersonalAgentDefaultModelResolver
{
	/** Resolves one accessible default model inside the caller's open transaction. */
	resolve(siloId: string): Promise<InitialPersonalAgentDefaultModelResolution>;
}

/** Current approved persona used to name and configure the first personal Agent revision. */
export interface InitialPersonalAgentPublicationPersona
{
	/** Approved persona revision selected for the executable revision. */
	readonly id: string;
	/** Display name inherited by the stable personal AgentService. */
	readonly displayName: string;
}

/** Transaction-scoped capability that publishes a personal Agent when no service exists. */
export interface InitialPersonalAgentPublicationRepository
{
	/** Creates, publishes, activates, and audits the first revision in the caller's transaction. */
	publish(command: PersonalAgentBootstrapCommand, persona: InitialPersonalAgentPublicationPersona): Promise<PersonalAgentBootstrapResult>;
}
