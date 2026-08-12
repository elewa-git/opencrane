import type { Types } from "@a2ui/angular/v0_8";

/** One option shown in a choice control that passed the admission check. */
export interface A2uiChoiceOption
{
	/** Agent-written label; the vendor resolves it through its data binding. */
	readonly label: Types.StringValue;
	/** The option's value. It only ever leaves as a local change event or a data-model write, never as an action. */
	readonly value: string;
}

/**
 * Where a choice control's current selection comes from.
 *
 * Exactly one of the two routes is used, and they behave differently on change: with `path` the
 * component writes the new selection back into the surface's data model; with `literalArray` it
 * has nowhere to write, so it emits the vendor's local `change` event instead. Callers reading
 * this must handle both.
 */
export interface A2uiChoiceSelections
{
	/** Path into the surface's data model, used when the selection is read from and written back there. */
	readonly path?: string;
	/** Selected values sent directly by the server, used when there is no `path` to read from. */
	readonly literalArray?: readonly string[];
}

/**
 * Which native control a v4 choice component renders as.
 *
 * The pinned vendor renderer collapses all three choice components into a single-value select.
 * A2uiChoiceComponent maps the component name onto one of these instead, so a SingleChoice really
 * renders as a radio group and a MultipleChoice really renders as checkboxes. Only `Multiple`
 * allows more than one selection; the admission check forces the other two to a limit of 1.
 *
 * @see A2uiChoiceComponent
 */
export enum A2uiChoiceKinds
{
	/** One visible option selected through a radio group. */
	Single = "single",
	/** Several visible options selected through checkboxes. */
	Multiple = "multiple",
	/** One option selected through a compact native select. */
	Select = "select"
}

/** The three native input types the date/time renderer can produce, chosen from the enableDate and enableTime flags. */
export type A2uiDateTimeInputType = "date" | "datetime-local" | "time";
