import type { Routes } from "@angular/router";

import { AuditRouteComponent } from "./audit/audit-route.component";
import { GovernanceReadContextStore } from "./reporting/governance-read-context.store";
import { UsageRouteComponent } from "./usage/usage-route.component";

/** Read-backed child destinations; the application owns the authenticated Settings shell. */
export const GOVERNANCE_ROUTES: Routes = [
	{ path: "audit", component: AuditRouteComponent, providers: [GovernanceReadContextStore] },
	{ path: "usage", component: UsageRouteComponent, providers: [GovernanceReadContextStore] }
];
