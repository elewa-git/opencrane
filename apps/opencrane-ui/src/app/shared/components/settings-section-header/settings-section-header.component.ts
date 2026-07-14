import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

/** Shared Settings title, subtitle, optional count, and primary action. */
@Component({
	selector: "oc-settings-section-header",
	imports: [ButtonModule],
	templateUrl: "./settings-section-header.component.html",
	styleUrl: "./settings-section-header.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsSectionHeaderComponent
{
	/** Section title. */
	public readonly title = input.required<string>();

	/** Section subtitle. */
	public readonly subtitle = input<string>();

	/** Optional count appended to the subtitle. */
	public readonly count = input<string>();

	/** Optional primary action label. */
	public readonly actionLabel = input<string>();

	/** Whether the primary action is disabled. */
	public readonly actionDisabled = input<boolean>(false);

	/** Emits when the primary action is requested. */
	public readonly action = output<void>();
}
