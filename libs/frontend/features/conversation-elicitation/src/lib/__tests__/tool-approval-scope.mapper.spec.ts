import { describe, expect, it } from "vitest";

import { ScopeChipTones } from "@opencrane/elements/ui";
import { ToolApprovalScopeReadStates, ToolApprovalScopeStates } from "@opencrane/state/conversation/elicitation";

import { _MapToolApprovalScopes } from "../tool-approval-scopes/tool-approval-scope.mapper";

describe("standing approval presentation mapper", function _StandingApprovalMapperSuite()
{
	it("maps only safe owner summaries and keeps row command states independent", function _Rows()
	{
		const view = _MapToolApprovalScopes({ readState: ToolApprovalScopeReadStates.Ready, error: null, hasMore: true, scopes: [{ id: "active", state: ToolApprovalScopeStates.Active, action: "Create event", target: "Calendar", connectionOwnerLabel: "Amina", createdAt: "2026-09-25T08:00:00.000Z" }, { id: "revoked", state: ToolApprovalScopeStates.Revoked, action: "Send message", target: "Supplier", connectionOwnerLabel: "Company assistant", createdAt: "2026-09-24T08:00:00.000Z", revokedAt: "2026-09-25T08:00:00.000Z" }] }, new Set(["active"]), { active: "Could not confirm." }, "revoked");
		expect(view.hasMore).toBe(true);
		expect(view.rows[0]).toMatchObject({ canRevoke: true, busy: true, error: "Could not confirm.", stateTone: ScopeChipTones.Success });
		expect(view.rows[1]).toMatchObject({ canRevoke: false, busy: false, revokedNow: true, stateTone: ScopeChipTones.Neutral });
		expect(JSON.stringify(view)).not.toContain("arguments");
	});
});
