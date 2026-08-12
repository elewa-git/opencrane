import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

/** Shared presentation for terminal Agent-thread route notices. */
@Component({
	selector: "wo-agent-thread-route-notice",
	standalone: true,
	imports: [ButtonModule, MessageModule],
	template: `<section class="route-state" [attr.aria-labelledby]="headingId()"><p-message [severity]="severity()"><h2 [id]="headingId()">{{ title() }}</h2><p>{{ detail() }}</p></p-message><p-button [label]="actionLabel()" icon="pi pi-arrow-left" [severity]="buttonSeverity()" (onClick)="returnRequested.emit()" /></section>`,
	styles: [`.route-state{display:grid;justify-items:center;gap:1rem;max-width:38rem;margin:auto;padding:2rem;text-align:center}`],
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class AgentThreadRouteNoticeComponent
{
	/** Stable heading id supplied by the owning lifecycle state. */
	public readonly headingId = input.required<string>();
	/** Truthful route-state title. */
	public readonly title = input.required<string>();
	/** Non-disclosing route-state explanation. */
	public readonly detail = input.required<string>();
	/** Return action label owned by the lifecycle state. */
	public readonly actionLabel = input.required<string>();
	/** PrimeNG message severity. */
	public readonly severity = input.required<"error" | "secondary">();
	/** PrimeNG button severity. */
	public readonly buttonSeverity = input<"danger" | "secondary" | undefined>(undefined);
	/** Requests navigation from the owning lifecycle state. */
	public readonly returnRequested = output<void>();
}
