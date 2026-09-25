import type { GovernanceAuditPage } from "@opencrane/state/governance";

import type { AuditResultRowView } from "./audit-results/audit-results-view.types";

/** Maps visible audit rows without inventing actor, outcome or total-count fields. */
export function _AuditRows(page: GovernanceAuditPage | null): readonly AuditResultRowView[]
{
	return (page?.data ?? []).map(function _Row(row, index)
	{
		return { id: String(index), timestamp: row.timestamp, action: row.action, resource: row.resource, message: row.message };
	});
}
