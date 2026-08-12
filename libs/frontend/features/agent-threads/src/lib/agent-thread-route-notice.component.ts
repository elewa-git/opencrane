import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, inject, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

/** Shared presentation for terminal Agent-thread route notices. */
@Component({ selector: "wo-agent-thread-route-notice", standalone: true, imports: [ButtonModule, MessageModule], templateUrl: "./agent-thread-route-notice.component.html", styleUrl: "./agent-thread-route-notice.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadRouteNoticeComponent
{
	/** Host element used to focus the replacement heading after Angular renders it. */
	private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
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
	/** Whether this notice must receive focus after it replaces authorized child content. */
	public readonly focusHeading = input(false);
	/** Requests navigation from the owning lifecycle state. */
	public readonly returnRequested = output<void>();
	/** Focus the replacement heading after the access-loss state reaches the DOM. */
	private readonly _focusAfterRender = afterRenderEffect(this._FocusHeading.bind(this));

	/** Move focus only for notices that replace content the user was already reading. */
	private _FocusHeading(): void
	{
		if (!this.focusHeading()) return;
		this._host.nativeElement.querySelector<HTMLElement>(`#${this.headingId()}`)?.focus({ preventScroll: true });
	}
}
