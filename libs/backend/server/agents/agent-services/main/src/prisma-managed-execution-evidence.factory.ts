import { _CreateFleetMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";

import { PrismaManagedExecutionEvidenceAuthority } from "./prisma-managed-execution-evidence.js";
import type { ManagedExecutionEvidenceAuthority } from "./managed-execution-evidence.types.js";

/**
 * Composes managed-service execution evidence from the deployment-selected membership trust.
 * @param environment - Process environment, injectable for configuration tests.
 * @returns The transaction-backed managed-service evidence authority.
 */
export function _CreateManagedExecutionEvidenceAuthority(environment: NodeJS.ProcessEnv = process.env): ManagedExecutionEvidenceAuthority
{
	const membership = _CreateFleetMembershipEvidenceConfig(environment);
	return new PrismaManagedExecutionEvidenceAuthority({
		trustedIssuerId: membership.trustedIssuerId,
		maximumStalenessMs: membership.maximumStalenessMs,
		verifier: membership.verifier,
	});
}
