import { ChangeDetectionStrategy, Component, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

/** Indistinguishable missing, foreign, and never-authorized child-route view. */
@Component({ selector: "wo-agent-thread-unavailable", standalone: true, imports: [ButtonModule, MessageModule], template: `<section class="route-state" aria-labelledby="unavailable-title"><p-message severity="secondary"><h2 id="unavailable-title">Agent thread unavailable</h2><p>This Agent thread cannot be opened.</p></p-message><p-button label="Return to chats" icon="pi pi-arrow-left" severity="secondary" (onClick)="returnRequested.emit()" /></section>`, styles: [`.route-state{display:grid;justify-items:center;gap:1rem;max-width:38rem;margin:auto;padding:2rem;text-align:center}`], changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadUnavailableComponent
{
	/** Requests a safe return without revealing a parent coordinate. */
	public readonly returnRequested = output<void>();
}
