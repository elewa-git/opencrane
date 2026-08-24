/**
 * Whether agent-services left a personal Agent ready for onboarding to use.
 *
 * The app adapter reads this result inside onboarding's transaction. `Ready` allows onboarding to
 * complete; `Denied` leaves onboarding incomplete. These string values cross the package boundary
 * but are not stored. Callers must reject any value outside this closed set.
 */
export enum PersonalAgentBootstrapStatuses
{
	/** A published personal agent is ready for conversation admission. */
	Ready = "ready",
	/** Authority evidence was missing, stale, or ambiguous, so no agent was created. */
	Denied = "denied",
}

/**
 * Why personal-Agent bootstrap refused to leave a service ready.
 *
 * The app adapter records this reason when it maps a denied agent-services result to onboarding.
 * These strings cross the package boundary but are not stored. An unknown reason is a contract
 * error and must never turn a denied result into readiness.
 */
export enum PersonalAgentBootstrapDenialReasons
{
	/** One or more required identities or the trusted provision instant is malformed. */
	InvalidCommand = "invalid_command",
	/** The approved persona does not belong to the exact subject and silo. */
	PersonaUnavailable = "persona_unavailable",
	/** The approved persona is no longer the subject's active persona revision. */
	PersonaNotActive = "persona_not_active",
	/** More than one active personal service matches the approved persona. */
	ServiceAmbiguous = "service_ambiguous",
	/** The onboarding identifier is already owned by another service authority. */
	ServiceIdentityConflict = "service_identity_conflict",
	/** The deterministic personal service exists but is not runnable. */
	ServiceNotReady = "service_not_ready",
	/** Neither the silo nor the platform has one default model. */
	DefaultModelUnavailable = "default_model_unavailable",
	/** The selected model scope contains more than one default. */
	DefaultModelAmbiguous = "default_model_ambiguous",
}

/** Evidence needed to resolve or create the personal agent for completed onboarding. */
export interface PersonalAgentBootstrapCommand
{
	/** Stable onboarding identifier reused as the collision-safe service identifier. */
	readonly onboardingId: string;
	/** Silo that owns the onboarding, persona, and personal agent. */
	readonly siloId: string;
	/** Authenticated subject that owns the approved persona and personal agent. */
	readonly subjectId: string;
	/** Approved persona revision pinned by onboarding. */
	readonly onboardingPersonaRevisionId: string;
	/** Completion rejects a concurrent persona change; repair may reconcile to the current persona. */
	readonly readinessKind: "completion" | "repair";
	/** Trusted instant used for every initial service, revision, publication, and audit timestamp. */
	readonly provisionedAt: Date;
}

/** Successful personal-agent readiness evidence returned to onboarding. */
export interface ReadyPersonalAgentBootstrapResult
{
	/** Stable success discriminator. */
	readonly status: PersonalAgentBootstrapStatuses.Ready;
	/** Stable personal AgentService identity. */
	readonly agentServiceId: string;
	/** Published revision currently active on the service. */
	readonly agentRevisionId: string;
	/** Whether this call created the service or resolved an earlier winner. */
	readonly created: boolean;
	/** Whether this call appended a revision to select the owner's current approved persona. */
	readonly revised: boolean;
}

/** Fail-closed result returned without committing any personal-agent writes. */
export interface DeniedPersonalAgentBootstrapResult
{
	/** Stable denial discriminator. */
	readonly status: PersonalAgentBootstrapStatuses.Denied;
	/** Authority condition that prevented readiness. */
	readonly reason: PersonalAgentBootstrapDenialReasons;
}

/** Complete result of resolving or creating an onboarding subject's personal agent. */
export type PersonalAgentBootstrapResult = ReadyPersonalAgentBootstrapResult | DeniedPersonalAgentBootstrapResult;

/**
 * Resolves or creates a personal AgentService inside a transaction owned by onboarding.
 *
 * Implemented by: `PrismaPersonalAgentBootstrapRepository` in
 * `db/prisma-personal-agent-bootstrap-repository.ts`.
 */
export interface PersonalAgentBootstrapRepository
{
	/** Validates authority and leaves one published personal agent ready in the open transaction. */
	ensureReady(command: PersonalAgentBootstrapCommand): Promise<PersonalAgentBootstrapResult>;
}
