import type { Routes } from "@angular/router";

import { ToolApprovalScopeRouteComponent } from "./tool-approval-scope-route.component";

/** Requester-owned standing approvals mounted beneath the authenticated Settings shell. */
export const TOOL_APPROVAL_SCOPE_ROUTES: Routes = [{ path: "approvals", component: ToolApprovalScopeRouteComponent }];
