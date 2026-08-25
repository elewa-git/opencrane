import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import type { McpbValidationWorkloadAssignment, McpbValidationWorkloadClaim } from "./mcpb-validation-repository.types";
import type { McpbValidationControllerAuthority } from "./mcpb-validation-controller.types";

/**
 * Builds the controller authority that changes claims and Job assignments through one unit of work.
 *
 * Each method enters the transaction before it delegates to the repository, so the route never
 * exposes a partly saved claim or assignment.
 * Called by: `_CreateControllerRuntimeComposition` in the OpenCrane app.
 * @param unitOfWork - Owns the MCP validation repository transaction.
 * @param claimLeaseMilliseconds - Limits how long a controller can hold a returned claim.
 * @returns The authority used by the internal controller router.
 */
export function __CreateMcpbValidationControllerAuthority(unitOfWork: McpOperatorUnitOfWork, claimLeaseMilliseconds: number): McpbValidationControllerAuthority
{
	return {
		claimNextAtomically(): Promise<McpbValidationWorkloadClaim | null>
		{
			return unitOfWork.execute(async function _Claim(transaction): Promise<McpbValidationWorkloadClaim | null>
			{
				return await transaction.mcpbValidations.claimNextWorkload(claimLeaseMilliseconds);
			});
		},
		commitAssignmentAtomically(workloadId: string, assignment: McpbValidationWorkloadAssignment): Promise<"assigned" | "idempotent" | "conflict">
		{
			return unitOfWork.execute(async function _CommitAssignment(transaction): Promise<"assigned" | "idempotent" | "conflict">
			{
				return await transaction.mcpbValidations.commitWorkloadAssignment(workloadId, assignment);
			});
		},
	};
}
