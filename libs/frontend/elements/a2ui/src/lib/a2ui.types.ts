import { AG_UI_A2UI_ENVELOPE_VERSION, AgUiA2uiSurfaceStates, type AgUiA2uiOperation } from "@opencrane/contracts";

/**
 * The component names OpenCrane's accepted v4 catalogue allows.
 *
 * Anything not listed here is rejected before the vendor renderer sees it, and the canvas shows
 * its placeholder instead. Adding a value therefore changes what the protocol accepts and needs a
 * matching renderer in a2ui.catalog.ts — it is not a local styling decision.
 *
 * @see A2UI v0.8 specification — the full upstream component catalogue this is a subset of:
 *   https://a2ui.org/specification/v0.8-a2ui/
 */
export enum A2uiComponentNames
{
	/** Rich text rendered through the injected sanitizer. */
	Text = "Text",
	/** A displayed action trigger that emits an intent only. */
	Button = "Button",
	/** A bounded text entry control. */
	TextField = "TextField",
	/** A one-value radio group rendered through the package-owned accessible protocol adapter. */
	SingleChoice = "SingleChoice",
	/** A bounded checkbox group rendered through the package-owned accessible protocol adapter. */
	MultipleChoice = "MultipleChoice",
	/** A one-value native selector rendered through the package-owned accessible protocol adapter. */
	Select = "Select",
	/** A bounded numeric input. */
	Slider = "Slider",
	/** A date, time, or combined date-time input. */
	DateTimeInput = "DateTimeInput",
	/** An image with display-safe URL and alternative text supplied upstream. */
	Image = "Image",
	/** A single-content visual grouping. */
	Card = "Card",
	/** An ordered group of child components. */
	List = "List"
}

/** The scalar types allowed to leave the renderer inside an action intent. */
export type A2uiDisplayedValueScalar = string | number | boolean | null;

/** One displayed value: a scalar, or a flat array of scalars. Nested objects and nested arrays are deliberately excluded. */
export type A2uiDisplayedValue = A2uiDisplayedValueScalar | readonly A2uiDisplayedValueScalar[];

/** Converts markdown to sanitized HTML. The app's root provider supplies the implementation. */
export type A2uiMarkdownSanitizer = (markdown: string) => string | Promise<string>;

/**
 * One snapshot of an A2UI surface, ready to display.
 *
 * The state layer builds this from an AG-UI A2UI envelope and hands it to
 * {@link A2uiCanvasComponent}. It is display-only: it says what to draw and what state the surface
 * is in, and carries nothing that could authorise an action.
 *
 * Two fields decide what the canvas does with it. The four ids together identify WHICH surface
 * this is — change any of them and the canvas throws its component tree away and starts again.
 * `sequence` orders updates to the SAME surface, and only a higher value is applied, so a
 * duplicate or late delivery is dropped rather than replayed.
 *
 * Every value here has already passed {@link _AdmitA2uiSurfacePresentation} before the vendor
 * renderer sees it.
 *
 * @see A2uiDisplayedActionIntent
 * @see AgUiA2uiSurfaceStates
 * @see A2UI v0.8 specification — defines `operations` and the component nodes inside them:
 *   https://a2ui.org/specification/v0.8-a2ui/
 */
export interface A2uiSurfacePresentation
{
	/** Version of the OpenCrane display envelope. */
	readonly version: typeof AG_UI_A2UI_ENVELOPE_VERSION;
	/** Conversation id; the server uses it to work out whether an action is allowed. */
	readonly conversationId: string;
	/** Run id this surface belongs to. */
	readonly runId: string;
	/** Message id the surface was displayed in. */
	readonly messageId: string;
	/** Surface id; every operation in this presentation must target it, or admission rejects the lot. */
	readonly surfaceId: string;
	/** Sequence number, which only ever increases; used to reject repeated or older updates. */
	readonly sequence: number;
	/** The current state, as sent by the server; only Ready allows the user to act. */
	readonly state: AgUiA2uiSurfaceStates;
	/** The vendor operations to apply, in order; already decoded by the state layer. */
	readonly operations: readonly AgUiA2uiOperation[];
	/** Optional text explaining a state other than Ready; already safe to show to the user. */
	readonly reason?: string;
}

/**
 * A report that the user activated an action on a displayed surface.
 *
 * Emitted by {@link A2uiCanvasComponent} on its `displayedAction` output. The host forwards it to
 * the server; the server decides whether the action is allowed, whether it has already been used,
 * and what it does. Receiving one of these proves only that a button was pressed on a surface that
 * was in the Ready state.
 *
 * The ids are copied straight from the presentation the action was shown on, so the server can
 * check the user acted on what it actually sent. `values` is limited to scalars and flat arrays of
 * scalars: no provider payload, credential or nested protocol context can travel in it.
 *
 * @see A2uiSurfacePresentation
 */
export interface A2uiDisplayedActionIntent
{
	/** Version of the OpenCrane display envelope that produced the intent. */
	readonly version: typeof AG_UI_A2UI_ENVELOPE_VERSION;
	/** Conversation id copied from the presentation that passed the admission check. */
	readonly conversationId: string;
	/** Run coordinate copied from the admitted presentation. */
	readonly runId: string;
	/** Message coordinate copied from the admitted presentation. */
	readonly messageId: string;
	/** Stable surface coordinate copied from the admitted presentation. */
	readonly surfaceId: string;
	/** Sequence of the presentation the action was displayed on, so the server can spot a stale click. */
	readonly sequence: number;
	/** Id of the action that was activated; the server decides what it may do from this plus the ids above. */
	readonly displayedActionId: string;
	/** Id of the component the user activated. */
	readonly sourceComponentId: string;
	/** Scalar values shown alongside the action, within the size limits; never raw protocol context or credentials. */
	readonly values: Readonly<Record<string, A2uiDisplayedValue>>;
}
