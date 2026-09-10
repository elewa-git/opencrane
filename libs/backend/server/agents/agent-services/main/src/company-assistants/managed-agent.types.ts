import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import type { HumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import type { ExecutionSubjectHumanMembershipEvidence } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

/** Contains the active company assistant's published model, tool selection and execution limits. */
export interface ManagedAgentRevisionEvidence
{
	/** Identifies the company service whose published revision is used. */
	readonly agentServiceId: string;
	/** Identifies the published revision admitted for this request. */
	readonly agentRevisionId: string;
	/** Binds the evidence to the contents of the published revision. */
	readonly agentRevisionDigest: string;
	/** Identifies the assistant's own principal for permission checks. */
	readonly principalId: string;
	/** Supplies the assistant's display name. */
	readonly name: string;
	/** Selects the deployed isolated execution profile. */
	readonly workloadProfile: string;
	/** Selects the model whose permission belongs to the assistant. */
	readonly modelDefinitionId: string;
	/** Lists the assigned tool revisions included in the run's effective contract digest. */
	readonly mcpToolRevisionIds: readonly string[];
	/** Carries the published call, token and duration limits. */
	readonly budget: JsonValue;
}

/** Supplies the exact managed identity and published profile a child conversation may freeze. */
export interface ManagedAgentConversationCandidate
{
	/** Identifies the company service whose published revision is used. */
	readonly agentServiceId: string;
	/** Identifies the published revision admitted for this request. */
	readonly agentRevisionId: string;
	/** Identifies the assistant in identity history. */
	readonly agentIdentityId: string;
	/** Identifies the assistant's own principal for permission checks. */
	readonly principalId: string;
	/** Supplies the assistant's display name. */
	readonly name: string;
	/** Selects the deployed isolated execution profile. */
	readonly workloadProfile: string;
	/** Identifies the published execution profile revision. */
	readonly profileRevisionId: string;
}

/** Current candidate facts shared by directory eligibility and recorded child-creation admission. */
export interface CurrentManagedAgentConversation
{
	/** Active service, identity and profile already checked against their current authorities. */
	readonly candidate: ManagedAgentConversationCandidate;
	/** Model whose Use permission belongs to the company's Principal. */
	readonly modelDefinitionId: string;
	/** Current verified human membership witness to bind into a recorded invocation. */
	readonly membership: ExecutionSubjectHumanMembershipEvidence;
	/** Trusted time used by both membership verification and permission decisions. */
	readonly nowEpochMs: number;
}

/** Supplies deployment-owned history, membership verification and published computer profiles. */
export interface ManagedAgentConversationDependencies
{
	/** Loads the current identity from its history. */
	readonly identityHistory: Pick<AgentIdentityHistory, "load">;
	/** Selects how the requesting human's membership is verified. */
	readonly membershipConfig: HumanMembershipEvidenceConfig;
	/** Lists the execution profiles installed by this deployment. */
	readonly profiles: readonly { readonly workloadProfile: string; readonly profileRevisionId: string }[];
	/** Supplies trusted server time when the caller needs a fixed admission time. */
	readonly nowEpochMs?: () => number;
}

/** Reads current managed service authority and independently verifies the human requester's membership. */
export interface ManagedExecutionEvidenceRepository
{
	/** Returns the currently published company revision, or null when it cannot execute. */
	loadCurrent(siloId: string, agentServiceId: string): Promise<ManagedAgentRevisionEvidence | null>;
	/** Returns current human membership, or null when its authority has ended or expired. */
	verifyRequesterMembership(siloId: string, principalId: string, nowEpochMs: number): Promise<ExecutionSubjectHumanMembershipEvidence | null>;
}
