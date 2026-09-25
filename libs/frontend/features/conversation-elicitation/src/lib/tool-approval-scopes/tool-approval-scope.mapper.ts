import { ScopeChipTones } from "@opencrane/elements/ui";
import { ToolApprovalScopeStates, type ToolApprovalScopeState, type ToolApprovalScopeSummary } from "@opencrane/state/conversation/elicitation";

import type { ToolApprovalScopeRowView, ToolApprovalScopeViewModel } from "./tool-approval-scope-view.types";

/** Map current requester state and command feedback into a presentation-only settings model. */
export function _MapToolApprovalScopes(state: ToolApprovalScopeState, busyIds: ReadonlySet<string>, commandErrors: Readonly<Record<string, string>>, revokedId: string | null): ToolApprovalScopeViewModel
{
	return { readState: state.readState, error: state.error, hasMore: state.hasMore, rows: state.scopes.map(scope => _Row(scope, busyIds.has(scope.id), commandErrors[scope.id] ?? null, revokedId === scope.id)) };
}

/** Map one server-owned safe summary without inventing hidden arguments or connection coordinates. */
function _Row(scope: ToolApprovalScopeSummary, busy: boolean, error: string | null, revokedNow: boolean): ToolApprovalScopeRowView
{
	const revoked = scope.state === ToolApprovalScopeStates.Revoked;
	return {
		id: scope.id,
		action: scope.action,
		target: scope.target,
		...(scope.externalSystem === undefined ? {} : { externalSystem: scope.externalSystem }),
		...(scope.assistantLabel === undefined ? {} : { assistantLabel: scope.assistantLabel }),
		connectionOwnerLabel: scope.connectionOwnerLabel,
		createdAtLabel: _Date(scope.createdAt),
		...(scope.revokedAt === undefined ? {} : { revokedAtLabel: _Date(scope.revokedAt) }),
		stateLabel: revoked ? "Revoked" : "Active",
		stateTone: revoked ? ScopeChipTones.Neutral : ScopeChipTones.Success,
		canRevoke: !revoked,
		busy,
		error,
		revokedNow
	};
}

/** Format a validated server instant for the current browser locale. */
function _Date(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
