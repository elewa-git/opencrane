import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { MessageModule } from "primeng/message";

/** Available state announcing that one serial follow-up may be composed. */
@Component({ selector: "wo-agent-thread-available", standalone: true, imports: [MessageModule], templateUrl: "./agent-thread-available.component.html", styleUrl: "./agent-thread-message-state.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadAvailableComponent
{
	/** Short display-safe availability label. */
	public readonly label = input("Ready for a follow-up");
}
