import { ChangeDetectionStrategy, Component, Input, computed, linkedSignal, signal } from "@angular/core";
import { DynamicComponent, type Types } from "@a2ui/angular/v0_8";

import { A2uiChoiceKinds, type A2uiChoiceOption, type A2uiChoiceSelections } from "./a2ui-control.types.js";
import { A2uiComponentNames } from "./a2ui.types.js";

/** Resolved option safe to bind to a native form control. */
interface _ResolvedChoiceOption
{
	/** Human-readable label resolved through the surface-owned data model. */
	readonly label: string;
	/** Stable scalar value supplied by the admitted presentation. */
	readonly value: string;
}

/**
 * Render the three admitted v4 choice contracts with their distinct native semantics.
 *
 * The pinned renderer collapses every choice to a one-value select and drops accessible labels.
 * This package-owned adapter retains the public component name, uses native radio/checkbox/select
 * controls, and emits only the upstream local `change` event that the canvas governance boundary
 * deliberately filters from displayed command intents.
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
	/** Reactive option storage updated through Angular's runtime-visible dynamic input metadata. */
	private readonly _options = signal<readonly A2uiChoiceOption[]>([]);

	/** Reactive selection storage updated through Angular's runtime-visible dynamic input metadata. */
	private readonly _selections = signal<A2uiChoiceSelections>({ literalArray: [] });

	/** Reactive maximum updated through Angular's runtime-visible dynamic input metadata. */
	private readonly _maxAllowedSelections = signal<number | undefined>(undefined);

	/** Protocol options bound by the upstream dynamic renderer. */
	@Input() public set options(options: readonly A2uiChoiceOption[] | undefined)
	{
		this._options.set(options ?? []);
	}

	/** Literal or surface-data selection binding supplied by the admitted presentation. */
	@Input({ required: true }) public set selections(selections: A2uiChoiceSelections)
	{
		this._selections.set(selections);
	}

	/** Maximum simultaneous selections; one-value aliases are additionally fenced by admission. */
	@Input() public set maxAllowedSelections(maxAllowedSelections: number | undefined)
	{
		this._maxAllowedSelections.set(maxAllowedSelections);
	}

	/** Stable native radio-group name unique to this renderer instance. */
	protected readonly radioGroupName = this.getUniqueId("a2ui-single-choice");

	/** Distinct semantics retained from the public v4 component name. */
	protected readonly kind = computed(function _ChoiceKind(this: A2uiChoiceComponent): A2uiChoiceKinds
	{
		switch (this.component().type)
		{
			case A2uiComponentNames.SingleChoice: return A2uiChoiceKinds.Single;
			case A2uiComponentNames.Select: return A2uiChoiceKinds.Select;
			default: return A2uiChoiceKinds.Multiple;
		}
	}.bind(this));

	/** Accessible label paired with the exact rendered native control semantics. */
	protected readonly label = computed(function _ChoiceLabel(this: A2uiChoiceComponent): string
	{
		switch (this.kind())
		{
			case A2uiChoiceKinds.Single: return "Single choice";
			case A2uiChoiceKinds.Select: return "Select";
			default: return "Multiple choice";
		}
	}.bind(this));

	/** Resolved option labels and their stable admitted scalar values. */
	protected readonly resolvedOptions = computed(function _ResolvedOptions(this: A2uiChoiceComponent): readonly _ResolvedChoiceOption[]
	{
		return this._options().map(function _ResolveOption(this: A2uiChoiceComponent, option: A2uiChoiceOption): _ResolvedChoiceOption
		{
			return { label: this.resolvePrimitive(option.label) ?? option.value, value: option.value };
		}.bind(this));
	}.bind(this));

	/** Current projected values with immediate local feedback until a newer projection arrives. */
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

	/** Whether another checkbox must be disabled at the authoritative selection limit. */
	protected isAtLimit(value: string): boolean
	{
		return !this.isSelected(value) && this.selectedValues().length >= this._selectionLimit();
	}

	/** Adopt one radio selection through the local governed change path. */
	protected onSingleChange(event: Event): void
	{
		const inputElement = event.target as HTMLInputElement;
		if (inputElement.checked)
		{
			this._commitSelections([inputElement.value]);
		}
	}

	/** Adopt one bounded checkbox change while enforcing the projected maximum locally. */
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

	/** Maximum values retained for the current distinct choice contract. */
	private _selectionLimit(): number
	{
		if (this.kind() !== A2uiChoiceKinds.Multiple)
		{
			return 1;
		}
		const configured = this._maxAllowedSelections();
		return configured !== undefined && Number.isSafeInteger(configured) && configured > 0 ? configured : Math.max(1, this._options().length);
	}

	/** Retain only unique known options up to the component's admitted selection limit. */
	private _boundedSelections(values: readonly string[]): readonly string[]
	{
		const allowed = new Set(this._options().map(function _OptionValue(option): string { return option.value; }));
		return [...new Set(values.filter(function _AllowedSelection(value): boolean { return allowed.has(value); }))].slice(0, this._selectionLimit());
	}

	/** Update path-bound display data or emit a filtered local change event for literal controls. */
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
