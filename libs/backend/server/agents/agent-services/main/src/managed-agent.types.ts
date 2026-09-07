import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import type { FleetMembershipEvidenceConfig, TrustedFleetMembershipEvidence } from "@opencrane/backend/server/iam/membership";
import type { JsonValue } from "@opencrane/util";

/** Contains the active company assistant and its first, deliberately unextended execution policy. */
export interface ManagedAgentRevisionEvidence
{
	readonly agentServiceId: string;
	readonly agentRevisionId: string;
	readonly agentRevisionDigest: string;
	readonly principalId: string;
	readonly name: string;
	readonly workloadProfile: string;
	readonly modelDefinitionId: string;
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

/** Supplies deployment-owned history, membership verification and published computer profiles. */
export interface ManagedAgentConversationDependencies
{
	readonly identityHistory: Pick<AgentIdentityHistory, "load">;
	readonly membershipConfig: FleetMembershipEvidenceConfig;
	readonly profiles: readonly { readonly workloadProfile: string; readonly profileRevisionId: string }[];
	readonly nowEpochMs?: () => number;
}

/** Reads current managed service authority and independently verifies the human requester's membership. */
export interface ManagedExecutionEvidenceRepository
{
	loadCurrent(siloId: string, agentServiceId: string): Promise<ManagedAgentRevisionEvidence | null>;
	verifyRequesterMembership(siloId: string, principalId: string, nowEpochMs: number): Promise<TrustedFleetMembershipEvidence | null>;
}
