import { ChangeDetectionStrategy, Component, output } from "@angular/core";

import { AgentThreadRouteNoticeComponent } from "./agent-thread-route-notice.component.js";

/** Indistinguishable missing, foreign, and never-authorized child-route view. */
@Component({ selector: "wo-agent-thread-unavailable", standalone: true, imports: [AgentThreadRouteNoticeComponent], templateUrl: "./agent-thread-unavailable.component.html", changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadUnavailableComponent
{
	/** Requests a safe return without revealing a parent coordinate. */
	public readonly returnRequested = output<void>();
}
