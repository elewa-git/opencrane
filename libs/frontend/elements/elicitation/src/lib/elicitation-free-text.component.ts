import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";

import { ElicitationBodyKinds, type ElicitationFreeTextBody, type ElicitationResponseValue } from "@opencrane/contracts";

/** Present one bounded text response and emit controlled drafts. */
@Component({ selector: "wo-elicitation-free-text", standalone: true, templateUrl: "./elicitation-free-text.component.html", styleUrl: "./elicitation-control.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ElicitationFreeTextComponent
{
	/** Exact server-authored text question and limit. */
	public readonly body = input.required<ElicitationFreeTextBody>();
	/** Current controlled draft. */
	public readonly value = input("");
	/** Whether the control is unavailable. */
	public readonly disabled = input(false);
	/** Emits a bounded draft without submitting it. */
	public readonly valueChange = output<ElicitationResponseValue>();

	/** Emit the browser-bounded text value. */
	public update(event: Event): void
	{
		if (!this.disabled()) this.valueChange.emit({ kind: ElicitationBodyKinds.FreeText, text: (event.target as HTMLTextAreaElement).value.slice(0, this.body().maximumLength) });
	}
}
