import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";

import { AuditResultsComponent } from "./audit-results/audit-results.component";
import { _AuditRows } from "./audit.mapper";
import { AuditStore } from "./audit.store";

/** Composes audit presentation and delegates read intents to its route-scoped store. */
@Component({ selector: "wo-audit-route", standalone: true, imports: [AuditResultsComponent], providers: [AuditStore], templateUrl: "./audit-route.component.html", changeDetection: ChangeDetectionStrategy.OnPush })
export class AuditRouteComponent
{
	/** Owns reads, cursors and recovery, never the template. */
	public readonly store = inject(AuditStore);
	/** Maps only permitted response fields for presentation. */
	public readonly rows = computed(() => _AuditRows(this.store.snapshot.value()));
}
