import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

/** Reusable label, description, help/error, and projected-control Settings row. */
@Component({
	selector: "oc-settings-row",
	templateUrl: "./settings-row.component.html",
	styleUrl: "./settings-row.component.scss",
	host:
	{
		role: "group",
		"[attr.aria-labelledby]": "labelId()",
		"[attr.aria-describedby]": "describedBy()"
	},
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsRowComponent
{
	/** Stable field identifier used for accessible associations. */
	public readonly fieldId = input.required<string>();

	/** Field label. */
	public readonly label = input.required<string>();

	/** Optional field description. */
	public readonly description = input<string>();

	/** Optional validation or help message. */
	public readonly message = input<string>();

	/** Whether the message represents a validation error. */
	public readonly invalid = input<boolean>(false);

	/** Identifier for the visible field label. */
	public readonly labelId = computed(function _LabelId(this: SettingsRowComponent): string
	{
		return `${this.fieldId()}-label`;
	}.bind(this));

	/** Identifier for the optional description. */
	public readonly descriptionId = computed(function _DescriptionId(this: SettingsRowComponent): string
	{
		return `${this.fieldId()}-description`;
	}.bind(this));

	/** Identifier for the optional help or error message. */
	public readonly messageId = computed(function _MessageId(this: SettingsRowComponent): string
	{
		return `${this.fieldId()}-message`;
	}.bind(this));

	/** IDs associated with the projected control group. */
	public readonly describedBy = computed(function _DescribedBy(this: SettingsRowComponent): string | null
	{
		const ids = [this.description() ? this.descriptionId() : null, this.message() ? this.messageId() : null].filter(Boolean);
		return ids.length ? ids.join(" ") : null;
	}.bind(this));
}
