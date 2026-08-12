import { ChangeDetectionStrategy, Component, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

/** Proven post-authorization access-loss state rendered only after local child data is purged. */
@Component({ selector: "wo-agent-thread-access-changed", standalone: true, imports: [ButtonModule, MessageModule], template: `<section class="route-state" aria-labelledby="access-changed-title"><p-message severity="error"><h2 id="access-changed-title">This Agent thread is no longer available</h2><p>Your access changed. Previously displayed child content and drafts were removed from this view.</p></p-message><p-button label="Return to parent chat" icon="pi pi-arrow-left" (onClick)="returnRequested.emit()" /></section>`, styles: [`.route-state{display:grid;justify-items:center;gap:1rem;max-width:38rem;margin:auto;padding:2rem;text-align:center}`], changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadAccessChangedComponent
{
	/** Requests exact parent restoration from the route coordinator. */
	public readonly returnRequested = output<void>();
}
