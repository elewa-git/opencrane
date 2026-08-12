import type { Types } from "@a2ui/angular/v0_8";

/** One display-safe option rendered by an admitted A2UI choice control. */
export interface A2uiChoiceOption
{
	/** Agent-authored label resolved through the upstream data-binding boundary. */
	readonly label: Types.StringValue;
	/** Stable scalar submitted only as a local change event or data-model update. */
	readonly value: string;
}

/** Selection binding accepted by the pinned v0.8 choice protocol. */
export interface A2uiChoiceSelections
{
	/** Optional relative path into the surface-owned data model. */
	readonly path?: string;
	/** Optional literal values supplied by the authoritative presentation. */
	readonly literalArray?: readonly string[];
}

/** Finite visual semantics retained for the three public v4 choice contracts. */
export enum A2uiChoiceKinds
{
	/** One visible option selected through a radio group. */
	Single = "single",
	/** Several visible options selected through checkboxes. */
	Multiple = "multiple",
	/** One option selected through a compact native select. */
	Select = "select"
}

/** Native input types admitted by the date/time renderer. */
export type A2uiDateTimeInputType = "date" | "datetime-local" | "time";
