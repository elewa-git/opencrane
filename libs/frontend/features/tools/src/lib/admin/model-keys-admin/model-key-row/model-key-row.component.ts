import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { ScopeChipAppearances, ScopeChipComponent, ScopeChipTones } from "@opencrane/elements/ui";
import { LITELLM_BADGE_STYLES, type ModelKeyRow } from "../model-keys-admin.types";
import { _BadgeFor } from "../model-keys-admin.utils";

/** Presents a provider's write-only key form; it never reads or retains stored key material. */
@Component({ selector: "tr[wo-model-key-row]", standalone: true, imports: [ScopeChipComponent], host: { "[class.wo-admin__row--off]": "!row().configured" }, templateUrl: "./model-key-row.component.html", styleUrl: "./model-key-row.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ModelKeyRowComponent
{
	/** Browser-safe status returned by the provider-key read. */
	public readonly row = input.required<ModelKeyRow>();
	/** Controlled unsaved input owned by the route store. */
	public readonly draft = input("");
	/** Whether this provider's command is pending. */
	public readonly busy = input(false);
	/** Reports a local edit without persisting anything. */
	public readonly draftChanged = output<string>();
	/** Requests saving the current draft. */
	public readonly submitted = output<void>();
	/** Requests the route's removal confirmation. */
	public readonly removeRequested = output<void>();
	/** Approved configuration-state tones. */
	public readonly chipTones = ScopeChipTones;
	/** Approved badge appearance. */
	public readonly chipAppearances = ScopeChipAppearances;
	/** Pure mapping of registration status to badge copy. */
	public readonly badgeStyle = computed(() => LITELLM_BADGE_STYLES[_BadgeFor(this.row())]);
	/** Emits the password edit without retaining a second copy. */
	public editDraft(event: Event): void { this.draftChanged.emit((event.target as HTMLInputElement).value); }
}
