import { ChangeDetectionStrategy, Component, output } from "@angular/core";

import { AgentThreadRouteNoticeComponent } from "./agent-thread-route-notice.component.js";

/** Indistinguishable missing, foreign, and never-authorized child-route view. */
@Component({ selector: "wo-agent-thread-unavailable", standalone: true, imports: [AgentThreadRouteNoticeComponent], template: `<wo-agent-thread-route-notice headingId="unavailable-title" title="Agent thread unavailable" detail="This Agent thread cannot be opened." actionLabel="Return to chats" severity="secondary" buttonSeverity="secondary" (returnRequested)="returnRequested.emit()" />`, changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadUnavailableComponent
{
	/** Requests a safe return without revealing a parent coordinate. */
	public readonly returnRequested = output<void>();
}
