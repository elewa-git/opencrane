import { ChangeDetectionStrategy, Component, output } from "@angular/core";

import { AgentThreadRouteNoticeComponent } from "./agent-thread-route-notice.component";

/** Proven post-authorization access-loss state rendered only after local child data is purged. */
@Component({ selector: "wo-agent-thread-access-changed", standalone: true, imports: [AgentThreadRouteNoticeComponent], templateUrl: "./agent-thread-access-changed.component.html", changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadAccessChangedComponent
{
	/** Requests exact parent restoration from the route coordinator. */
	public readonly returnRequested = output<void>();
}
