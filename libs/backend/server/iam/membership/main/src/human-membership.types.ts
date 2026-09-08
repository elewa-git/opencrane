import type { ExecutionSubjectHumanMembershipEvidence } from "@opencrane/contracts";

import type { FleetMembershipDeploymentModes, FleetMembershipEvidenceConfig } from "./membership-authority.types";

/**
 * Selects one deployment-owned human authority. The union prevents local evidence from carrying
 * a Fleet verifier or being interpreted as signed evidence when configuration is incomplete.
 */
export type HumanMembershipEvidenceConfig =
	| (FleetMembershipEvidenceConfig & { readonly mode: FleetMembershipDeploymentModes.Fleet })
	| { readonly mode: FleetMembershipDeploymentModes.Standalone; readonly siloId: string; readonly trustedOidcIssuer: string; readonly maximumStalenessMs: number };

/** Reads human evidence in the caller's transaction without granting product permissions. */
export interface HumanMembershipEvidenceRepository
{
	/** Returns current evidence or null for absent, inactive, stale or mismatched membership. */
	load(siloId: string, principalId: string, nowEpochMs: number): Promise<ExecutionSubjectHumanMembershipEvidence | null>;
}
