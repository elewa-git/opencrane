import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { MessageModule } from "primeng/message";

/** Queued first-run state shown after atomic child admission. */
@Component({ selector: "wo-agent-thread-queued", standalone: true, imports: [MessageModule], templateUrl: "./agent-thread-queued.component.html", styleUrl: "./agent-thread-message-state.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadQueuedComponent
{
	/** Display-safe queue explanation without a promised position or time. */
	public readonly detail = input("The child and first run exist. OpenCrane will start it when capacity is available.");
}
