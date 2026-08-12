import { ChangeDetectionStrategy, Component, Input, computed, linkedSignal, signal } from "@angular/core";
import { DynamicComponent, type Types } from "@a2ui/angular/v0_8";

import { A2uiChoiceKinds, type A2uiChoiceOption, type A2uiChoiceSelections } from "./a2ui-control.types.js";
import { A2uiComponentNames } from "./a2ui.types.js";

/** One option after its label has been resolved, ready to bind to a native control. */
interface _ResolvedChoiceOption
{
	/** Human-readable label resolved through the surface-owned data model. */
	readonly label: string;
	/** Stable scalar value supplied by the admitted presentation. */
	readonly value: string;
}

/**
 * Renders SingleChoice, MultipleChoice and Select as the native control each one should be.
 *
 * Why this exists: the pinned vendor renderer turns every choice into a single-value select and
 * drops the accessible label. This adapter keeps the public component name so the protocol is
 * unchanged, but renders a real radio group, checkbox group or select, with a label.
 *
 * Selecting something never sends a command. When the selection is bound to a `path` the new
 * value is written into the surface's data model; otherwise the vendor's local `change` event is
 * emitted. A2uiCanvasComponent filters `change` out of action intents, so a choice can only ever
 * prepare a later button press.
 *
 * Rendered by: the vendor's dynamic renderer, via _loadChoice in a2ui.catalog.ts — never placed in
 * a template directly. Inputs are bound by the vendor: `options`, `selections` (required),
 * `maxAllowedSelections`.
 *
 * @see A2uiChoiceKinds
 * @see A2uiChoiceSelections
 * @see A2UI v0.8 specification — SingleChoice, MultipleChoice and Select, including
 *   maxAllowedSelections: https://a2ui.org/specification/v0.8-a2ui/
 */
@Component({
	selector: "wo-a2ui-choice",
	standalone: true,
	templateUrl: "./a2ui-choice.component.html",
	styleUrl: "./a2ui-choice.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class A2uiChoiceComponent extends DynamicComponent<Types.AnyComponentNode>
{
	/** Holds the options; written by the `options` setter below so the vendor's renderer can bind to it. */
	private readonly _options = signal<readonly A2uiChoiceOption[]>([]);

	/** Reactive selection storage updated through Angular's runtime-visible dynamic input metadata. */
	private readonly _selections = signal<A2uiChoiceSelections>({ literalArray: [] });

	/** Reactive maximum updated through Angular's runtime-visible dynamic input metadata. */
	private readonly _maxAllowedSelections = signal<number | undefined>(undefined);

	/** Options bound in by the vendor's dynamic renderer. */
	@Input() public set options(options: readonly A2uiChoiceOption[] | undefined)
	{
		this._options.set(options ?? []);
	}

	/** Where the current selection comes from: literal values, or a path into the surface data model. */
	@Input({ required: true }) public set selections(selections: A2uiChoiceSelections)
	{
		this._selections.set(selections);
	}

	/** How many options may be selected at once. For SingleChoice and Select the admission check also forces this to 1. */
	@Input() public set maxAllowedSelections(maxAllowedSelections: number | undefined)
	{
		this._maxAllowedSelections.set(maxAllowedSelections);
	}

	/** The `name` shared by this instance's radio inputs; unique per instance so two groups never merge. */
	protected readonly radioGroupName = this.getUniqueId("a2ui-single-choice");

	/** Which native control to render, worked out from the v4 component name. */
	protected readonly kind = computed(function _ChoiceKind(this: A2uiChoiceComponent): A2uiChoiceKinds
	{
		switch (this.component().type)
		{
			case A2uiComponentNames.SingleChoice: return A2uiChoiceKinds.Single;
			case A2uiComponentNames.Select: return A2uiChoiceKinds.Select;
			default: return A2uiChoiceKinds.Multiple;
		}
	}.bind(this));

	/** Accessible label matching whichever native control is actually rendered. */
	protected readonly label = computed(function _ChoiceLabel(this: A2uiChoiceComponent): string
	{
		switch (this.kind())
		{
			case A2uiChoiceKinds.Single: return "Single choice";
			case A2uiChoiceKinds.Select: return "Select";
			default: return "Multiple choice";
		}
	}.bind(this));

	/** The options with their labels resolved, paired with their values. */
	protected readonly resolvedOptions = computed(function _ResolvedOptions(this: A2uiChoiceComponent): readonly _ResolvedChoiceOption[]
	{
		return this._options().map(function _ResolveOption(this: A2uiChoiceComponent, option: A2uiChoiceOption): _ResolvedChoiceOption
		{
			return { label: this.resolvePrimitive(option.label) ?? option.value, value: option.value };
		}.bind(this));
	}.bind(this));

	/**
	 * The values currently selected.
	 *
	 * A `linkedSignal`, so a click shows immediately and is then replaced whenever the server sends a
	 * newer presentation. Reads from `literalArray` when present, otherwise from the surface data
	 * model at `path`; unknown and duplicate values are dropped and the list is cut to the selection
	 * limit before it is used.
	 */
	protected readonly selectedValues = linkedSignal<readonly string[]>(function _ProjectedSelections(this: A2uiChoiceComponent): readonly string[]
	{
		this.processor.version();
		const selections = this._selections();
		if (selections.literalArray !== undefined)
		{
			return this._boundedSelections(selections.literalArray);
		}
		const surfaceId = this.surfaceId();
		if (selections.path === undefined || surfaceId === null)
		{
			return [];
		}
		const value = this.processor.getData(this.component(), selections.path, surfaceId);
		return Array.isArray(value) ? this._boundedSelections(value.filter(function _IsString(item): item is string { return typeof item === "string"; })) : [];
	}.bind(this));

	/** Whether an option is currently selected. */
	protected isSelected(value: string): boolean
	{
		return this.selectedValues().includes(value);
	}

	/** Whether this checkbox must be disabled because the selection limit is already reached. */
	protected isAtLimit(value: string): boolean
	{
		return !this.isSelected(value) && this.selectedValues().length >= this._selectionLimit();
	}

	/** Apply one radio selection through the local change path. */
	protected onSingleChange(event: Event): void
	{
		const inputElement = event.target as HTMLInputElement;
		if (inputElement.checked)
		{
			this._commitSelections([inputElement.value]);
		}
	}

	/** Apply one checkbox change, refusing it here once the maximum is reached. */
	protected onMultipleChange(event: Event): void
	{
		const inputElement = event.target as HTMLInputElement;
		const current = this.selectedValues();
		if (inputElement.checked && current.length >= this._selectionLimit())
		{
			inputElement.checked = false;
			return;
		}
		const next = inputElement.checked ? [...current, inputElement.value] : current.filter(function _KeepSelection(value): boolean { return value !== inputElement.value; });
		this._commitSelections(next);
	}

	/** Adopt one compact select value through the same governed local change path. */
	protected onSelectChange(event: Event): void
	{
		this._commitSelections([(event.target as HTMLSelectElement).value]);
	}

	/** How many values may be selected for the current choice kind. */
	private _selectionLimit(): number
	{
		if (this.kind() !== A2uiChoiceKinds.Multiple)
		{
			return 1;
		}
		const configured = this._maxAllowedSelections();
		return configured !== undefined && Number.isSafeInteger(configured) && configured > 0 ? configured : Math.max(1, this._options().length);
	}

	/** Drop unknown and duplicate values, then cut the list to the selection limit. */
	private _boundedSelections(values: readonly string[]): readonly string[]
	{
		const allowed = new Set(this._options().map(function _OptionValue(option): string { return option.value; }));
		return [...new Set(values.filter(function _AllowedSelection(value): boolean { return allowed.has(value); }))].slice(0, this._selectionLimit());
	}

	/** Write to the surface data model when the selection is path-bound; otherwise emit the local `change` event. */
	private _commitSelections(values: readonly string[]): void
	{
		const bounded = this._boundedSelections(values);
		this.selectedValues.set(bounded);
		const selections = this._selections();
		const surfaceId = this.surfaceId();
		if (selections.path !== undefined && surfaceId !== null)
		{
			this.processor.setData(this.component(), selections.path, [...bounded], surfaceId);
			return;
		}
		void this.sendAction({ name: "change", context: [{ key: "value", value: { literalString: JSON.stringify(bounded) } }] });
	}
}
