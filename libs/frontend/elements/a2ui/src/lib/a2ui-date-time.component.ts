import { ChangeDetectionStrategy, Component, Input, computed, linkedSignal, signal } from "@angular/core";
import { DynamicComponent, type Types } from "@a2ui/angular/v0_8";

import type { A2uiDateTimeInputType } from "./a2ui-control.types.js";

/**
 * Renders the v0.8 DateTimeInput component as a native date, time or datetime-local input.
 *
 * Why this exists: the pinned schema drops the renderer's optional label before binding, leaving
 * the input unlabelled. This adapter builds the label and the input type from `enableDate` and
 * `enableTime` instead.
 *
 * Changing the value never sends a command. When the value is bound to a `path` the new text is
 * written into the surface's data model; otherwise the vendor's local `change` event is emitted,
 * which A2uiCanvasComponent filters out of action intents.
 *
 * Rendered by: the vendor's dynamic renderer, via _loadDateTimeInput in a2ui.catalog.ts — never
 * placed in a template directly. Inputs are bound by the vendor: `value` (required), `enableDate`,
 * `enableTime`.
 *
 * @see A2uiDateTimeInputType
 * @see A2UI v0.8 specification — DateTimeInput and its enableDate/enableTime flags:
 *   https://a2ui.org/specification/v0.8-a2ui/
 */
@Component({
	selector: "wo-a2ui-date-time",
	standalone: true,
	templateUrl: "./a2ui-date-time.component.html",
	styleUrl: "./a2ui-date-time.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class A2uiDateTimeComponent extends DynamicComponent<Types.DateTimeInputNode>
{
	/** Reactive value updated through Angular's runtime-visible dynamic input metadata. */
	private readonly _value = signal<Types.StringValue>({ literalString: "" });

	/** Reactive date flag updated through Angular's runtime-visible dynamic input metadata. */
	private readonly _enableDate = signal(true);

	/** Reactive time flag updated through Angular's runtime-visible dynamic input metadata. */
	private readonly _enableTime = signal(false);

	/** Date/time value bound by the upstream dynamic renderer. */
	@Input({ required: true }) public set value(value: Types.StringValue)
	{
		this._value.set(value);
	}

	/** Whether the native control captures a calendar date. */
	@Input() public set enableDate(enableDate: boolean | undefined)
	{
		this._enableDate.set(enableDate ?? true);
	}

	/** Whether the native control captures a clock time. */
	@Input() public set enableTime(enableTime: boolean | undefined)
	{
		this._enableTime.set(enableTime ?? false);
	}

	/** Id linking the label to the input, unique per instance. */
	protected readonly inputId = this.getUniqueId("a2ui-date-time");

	/** The native input type, chosen from `enableDate` and `enableTime`. */
	protected readonly inputType = computed(function _InputType(this: A2uiDateTimeComponent): A2uiDateTimeInputType
	{
		if (this._enableDate() && this._enableTime()) return "datetime-local";
		if (this._enableTime()) return "time";
		return "date";
	}.bind(this));

	/** Accessible name matching the input type actually rendered. */
	protected readonly label = computed(function _InputLabel(this: A2uiDateTimeComponent): string
	{
		switch (this.inputType())
		{
			case "datetime-local": return "Date and time";
			case "time": return "Time";
			default: return "Date";
		}
	}.bind(this));

	/** Current projected value with immediate local feedback until a newer projection arrives. */
	protected readonly resolvedValue = linkedSignal<string>(function _ProjectedValue(this: A2uiDateTimeComponent): string
	{
		this.processor.version();
		return this.resolvePrimitive(this._value()) ?? "";
	}.bind(this));

	/** Write to the surface data model when the value is path-bound; otherwise emit the local `change` event. */
	protected onChange(event: Event): void
	{
		const nextValue = (event.target as HTMLInputElement).value;
		this.resolvedValue.set(nextValue);
		const value = this._value();
		const surfaceId = this.surfaceId();
		if (value.path !== undefined && surfaceId !== null)
		{
			this.processor.setData(this.component(), value.path, nextValue, surfaceId);
			return;
		}
		void this.sendAction({ name: "change", context: [{ key: "value", value: { literalString: nextValue } }] });
	}
}
