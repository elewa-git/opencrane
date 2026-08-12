import { ChangeDetectionStrategy, Component, output } from "@angular/core";

import { AgentThreadRouteNoticeComponent } from "./agent-thread-route-notice.component.js";

/** Proven post-authorization access-loss state rendered only after local child data is purged. */
@Component({ selector: "wo-agent-thread-access-changed", standalone: true, imports: [AgentThreadRouteNoticeComponent], template: `<wo-agent-thread-route-notice headingId="access-changed-title" title="This Agent thread is no longer available" detail="Your access changed. Previously displayed child content and drafts were removed from this view." actionLabel="Return to parent chat" severity="error" buttonSeverity="danger" (returnRequested)="returnRequested.emit()" />`, changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadAccessChangedComponent
{
	/** Requests exact parent restoration from the route coordinator. */
	public readonly returnRequested = output<void>();
}
