import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";

import { ToolApprovalScopeStore } from "@opencrane/state/conversation/elicitation";

import { _MapToolApprovalScopes } from "./tool-approval-scope.mapper";
import { ToolApprovalScopeViewComponent } from "./tool-approval-scope-view.component";

/** Thin routed coordinator for requester-owned standing approval state and presentation. */
@Component({ selector: "wo-tool-approval-scope-route", standalone: true, imports: [ToolApprovalScopeViewComponent], providers: [ToolApprovalScopeStore], templateUrl: "./tool-approval-scope-route.component.html", changeDetection: ChangeDetectionStrategy.OnPush })
export class ToolApprovalScopeRouteComponent
{
	/** Route-scoped read, paging and revocation owner. */
	protected readonly store = inject(ToolApprovalScopeStore);
	/** Pure presentation projection. */
	protected readonly view = computed(() => _MapToolApprovalScopes(this.store.state(), this.store.busyIds(), this.store.commandErrors(), this.store.revokedId()));
}
