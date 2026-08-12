import { ChangeDetectionStrategy, Component, Input, computed, linkedSignal, signal } from "@angular/core";
import { DynamicComponent, type Types } from "@a2ui/angular/v0_8";

import type { A2uiDateTimeInputType } from "./a2ui-control.types.js";

/**
 * Accessible package-owned adapter for the admitted pinned v0.8 date/time contract.
 *
 * The pinned schema drops its renderer's optional label before binding. This adapter derives the
 * exact native input label from the retained date/time flags while keeping local data-model changes
 * and filtered `change` events inside the same upstream protocol boundary.
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

	/** Stable accessible label/control association. */
	protected readonly inputId = this.getUniqueId("a2ui-date-time");

	/** Native input type derived from the protocol flags retained by the pinned schema. */
	protected readonly inputType = computed(function _InputType(this: A2uiDateTimeComponent): A2uiDateTimeInputType
	{
		if (this._enableDate() && this._enableTime()) return "datetime-local";
		if (this._enableTime()) return "time";
		return "date";
	}.bind(this));

	/** Accessible name that describes the exact native input mode. */
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

	/** Update path-bound display data or emit a governed local change event for a literal control. */
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
