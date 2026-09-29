import type { ToolApprovalScopeSummary } from "@opencrane/contracts";

import type { ToolApprovalScopeSummarySource } from "./tool-approval-scope-mappers.types";

/** Maps a saved scope to the metadata that its requester may list. */
export function _ToolApprovalScopeSummary(scope: ToolApprovalScopeSummarySource): ToolApprovalScopeSummary
{
	return {
		id: scope.id,
		state: scope.state,
		action: scope.actionLabel,
		target: scope.targetLabel,
		...(scope.externalSystemLabel === null ? {} : { externalSystem: scope.externalSystemLabel }),
		...(scope.assistantLabel === null ? {} : { assistantLabel: scope.assistantLabel }),
		connectionOwnerLabel: scope.connectionOwnerLabel,
		createdAt: scope.createdAt.toISOString(),
		...(scope.revokedAt === null ? {} : { revokedAt: scope.revokedAt.toISOString() }),
	};
}
