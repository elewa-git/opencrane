import { ChangeDetectionStrategy, Component, signal } from "@angular/core";

import { CanvasInitiative, CanvasMetric, CanvasRisk } from "@opencrane/core";

/** Status display metadata for canvas initiative rows. */
interface InitiativeStatusStyle { color: string; label: string; }

/** Canvas document panel — populated from the live gateway once available. */
@Component({
	selector: "wo-canvas-doc",
	standalone: true,
	templateUrl: "./canvas-doc.component.html",
	styleUrl: "./canvas-doc.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class CanvasDocComponent
{
	/** Whether the save confirmation is showing. */
	public readonly saved = signal<boolean>(false);

	/** Growth target metric rows — populated from the live gateway once available. */
	public readonly metrics: CanvasMetric[] = [];

	/** Key initiative rows — populated from the live gateway once available. */
	public readonly initiatives: CanvasInitiative[] = [];

	/** Top risk rows — populated from the live gateway once available. */
	public readonly risks: CanvasRisk[] = [];

	/** Resolves status display metadata for an initiative. */
	public statusStyle(status: string): InitiativeStatusStyle
	{
		switch (status)
		{
			case "on-track": return { color: "#5A8A5A", label: "on track" };
			case "at-risk": return { color: "#A0855A", label: "at risk" };
			default: return { color: "var(--oc-ink-muted)", label: "pending" };
		}
	}

	/** Shows the saved confirmation for two seconds. */
	public save(): void
	{
		this.saved.set(true);
		setTimeout(() => this.saved.set(false), 2000);
	}
}
