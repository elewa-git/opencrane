import type { UserOnboardingCompletionProvenances, UserOnboardingStates } from "./user-onboarding.enums";
import type { UserOnboardingOwner } from "./user-onboarding.types";

/**
 * Whether onboarding may admit the owner to the ordinary workspace.
 *
 * Onboarding authorities branch on this result after completion or repair. The string values cross
 * the package's app-composition boundary but are not stored. An unknown value is a contract error
 * and must deny admission.
 */
export enum UserOnboardingReadinessStatuses
{
	/** Onboarding is complete and its personal Agent is ready. */
	Ready = "ready",
	/** A migrated completed user has no bootstrap evidence from which to create an Agent. */
	NotApplicable = "not_applicable",
	/** The user has not completed the required onboarding flow. */
	OnboardingRequired = "onboarding_required",
	/** Exact bootstrap or personal-Agent authority could not be established. */
	AuthorityUnavailable = "authority_unavailable",
}

/** Exact onboarding-owned evidence read inside the completion transaction. */
export interface UserOnboardingCompletionEvidence
{
	/** Stable onboarding record used as the deterministic personal Agent identity. */
	readonly onboardingId: string;
	/** Session-derived organisation silo. */
	readonly siloId: string;
	/** Session-derived authenticated subject. */
	readonly subjectId: string;
	/** Current durable onboarding state. */
	readonly state: UserOnboardingStates;
	/** Reviewed reason a completed row was admitted. */
	readonly completionProvenance: UserOnboardingCompletionProvenances | null;
	/** Exact pinned bootstrap conversation. */
	readonly conversationId: string | null;
	/** Exact pinned approved persona revision. */
	readonly personaRevisionId: string | null;
	/** Whether every immutable conversation/content pin still agrees with the onboarding row. */
	readonly bootstrapPinsMatch: boolean;
	/** Number of reviewed questions in the pinned content revision. */
	readonly questionCount: number;
	/** Ordered question coordinates answered in the pinned conversation. */
	readonly answeredQuestionOrdinals: readonly number[];
}

/** Onboarding-owned writes available only inside its Serializable completion transaction. */
export interface UserOnboardingCompletionRepository
{
	/** Re-read exact owner-bound completion evidence. */
	readEvidence(owner: UserOnboardingOwner): Promise<UserOnboardingCompletionEvidence | null>;
	/** Mark only the exact active bootstrap conversation complete, as the transaction's last write. */
	markCompleted(owner: UserOnboardingOwner, conversationId: string, completedAt: Date): Promise<boolean>;
}

/** Result of completion or readiness repair without leaking persistence detail. */
export interface UserOnboardingReadinessResult
{
	/** Stable admission outcome. */
	readonly status: UserOnboardingReadinessStatuses;
	/** Ready personal Agent identity, present only after successful bootstrap. */
	readonly agentServiceId: string | null;
}

/** Cross-domain command onboarding gives to the agent-services adapter inside its transaction. */
export interface UserOnboardingPersonalAgentBootstrapCommand
{
	/** Stable onboarding identifier reused as the deterministic personal Agent identity. */
	readonly onboardingId: string;
	/** Session-derived organisation silo. */
	readonly siloId: string;
	/** Session-derived authenticated subject. */
	readonly subjectId: string;
	/** Exact approved persona revision pinned by onboarding. */
	readonly onboardingPersonaRevisionId: string;
	/** Completion rejects a concurrent persona change; repair may reconcile to the current persona. */
	readonly readinessKind: "completion" | "repair";
	/** Trusted instant for initial publication evidence. */
	readonly provisionedAt: Date;
}

/**
 * Whether the app-owned agent-services adapter proved personal-Agent readiness.
 *
 * The onboarding completion authority branches on these strings inside its transaction. They cross
 * the app-to-package boundary but are not stored. An unknown value is a contract error and must be
 * handled as denial.
 */
export enum UserOnboardingPersonalAgentBootstrapStatuses
{
	/** Agent-services proved one runnable personal Agent for this owner. */
	Ready = "ready",
	/** Agent-services could not prove the required authority. */
	Denied = "denied",
}

/** Narrow structural result returned by the app-owned agent-services adapter. */
export type UserOnboardingPersonalAgentBootstrapResult =
	| { readonly status: UserOnboardingPersonalAgentBootstrapStatuses.Ready; readonly agentServiceId: string }
	| { readonly status: UserOnboardingPersonalAgentBootstrapStatuses.Denied };

/** Personal Agent capability supplied to onboarding without importing agent-services. */
export interface UserOnboardingPersonalAgentBootstrapPort
{
	/** Resolve or create the exact ready personal Agent in the surrounding transaction. */
	ensureReady(command: UserOnboardingPersonalAgentBootstrapCommand): Promise<UserOnboardingPersonalAgentBootstrapResult>;
}

/** Retry-safe transaction boundary used by conclusion and ordinary-product admission. */
export interface UserOnboardingCompletionUnitOfWork
{
	/** Provision the personal Agent and only then mark the exact onboarding conversation complete. */
	complete(owner: UserOnboardingOwner, conversationId: string, completedAt: Date): Promise<UserOnboardingReadinessResult>;
	/** Validate or repair a completed bootstrap-concluded onboarding. */
	ensureReady(owner: UserOnboardingOwner): Promise<UserOnboardingReadinessResult>;
}
