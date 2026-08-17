import type { PersonalAgentBootstrapCommand, PersonalAgentBootstrapResult } from "./personal-agent-bootstrap.types";

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
