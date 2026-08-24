import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import type { McpbValidationWorkloadAssignment, McpbValidationWorkloadClaim } from "./mcpb-validation-repository.types";
import type { McpbValidationControllerAuthority } from "./mcpb-validation-controller.types";

/** Creates the transaction-bound authority behind the MCP bundle validator controller routes. */
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
