import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { MessageModule } from "primeng/message";

/** Available state announcing that one serial follow-up may be composed. */
@Component({ selector: "wo-agent-thread-available", standalone: true, imports: [MessageModule], template: `<p-message severity="success"><strong>{{ label() }}</strong><span>The composer accepts one follow-up for the next serial run.</span></p-message>`, styles: [`:host{display:block}:host ::ng-deep .p-message-text strong,:host ::ng-deep .p-message-text span{display:block}`], changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadAvailableComponent
{
	/** Short display-safe availability label. */
	public readonly label = input("Ready for a follow-up");
}
