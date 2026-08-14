import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { ConversationStatusLineComponent } from "@opencrane/elements/conversation";
import type { AgentThreadRunBoundaryPresentation } from "@opencrane/state/conversation/agent-threads";

import { __AgentThreadRunStatusPresentation } from "./agent-thread.mapper.js";

/** Visible boundary preserving serial run order inside one child conversation. */
@Component({ selector: "wo-agent-thread-run-boundary", standalone: true, imports: [ConversationStatusLineComponent], templateUrl: "./agent-thread-run-boundary.component.html", styleUrl: "./agent-thread-run-boundary.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadRunBoundaryComponent
{
	/** Exact display-safe serial run projection. */
	public readonly run = input.required<AgentThreadRunBoundaryPresentation>();

	/** Derive the shared status-line presentation. */
	protected status() { return __AgentThreadRunStatusPresentation(this.run()); }
}
