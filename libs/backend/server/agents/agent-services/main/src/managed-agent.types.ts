import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import type { HumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import type { ExecutionSubjectHumanMembershipEvidence } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

/** Contains the active company assistant's published model, tool selection and execution limits. */
export interface ManagedAgentRevisionEvidence
{
	readonly agentServiceId: string;
	readonly agentRevisionId: string;
	readonly agentRevisionDigest: string;
	readonly principalId: string;
	readonly name: string;
	readonly workloadProfile: string;
	readonly modelDefinitionId: string;
	/** Binds the canonical exact tool assignment into the run's effective contract digest. */
	readonly mcpToolRevisionIds: readonly string[];
	readonly budget: JsonValue;
}

/** Supplies the exact managed identity and published profile a child conversation may freeze. */
export interface ManagedAgentConversationCandidate
{
	readonly agentServiceId: string;
	readonly agentRevisionId: string;
	readonly agentIdentityId: string;
	readonly principalId: string;
	readonly name: string;
	readonly workloadProfile: string;
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
	readonly identityHistory: Pick<AgentIdentityHistory, "load">;
	readonly membershipConfig: HumanMembershipEvidenceConfig;
	readonly profiles: readonly { readonly workloadProfile: string; readonly profileRevisionId: string }[];
	readonly nowEpochMs?: () => number;
}

/** Reads current managed service authority and independently verifies the human requester's membership. */
export interface ManagedExecutionEvidenceRepository
{
	loadCurrent(siloId: string, agentServiceId: string): Promise<ManagedAgentRevisionEvidence | null>;
	verifyRequesterMembership(siloId: string, principalId: string, nowEpochMs: number): Promise<ExecutionSubjectHumanMembershipEvidence | null>;
}
