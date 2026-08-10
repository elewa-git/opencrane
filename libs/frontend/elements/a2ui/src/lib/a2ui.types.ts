import type { Types } from "@a2ui/angular/v0_8";

/**
 * Stable OpenCrane envelope versions accepted by the browser A2UI sink.
 *
 * The string is carried across the display boundary. It describes presentation data only and
 * grants no permission to execute an action.
 */
export enum A2uiEnvelopeVersions
{
	/** First display-safe OpenCrane A2UI envelope. */
	OpenCraneV1 = "opencrane.a2ui.v1"
}

/**
 * Finite presentation lifecycle for one server-projected A2UI surface.
 *
 * These values control browser presentation only. Canonical run and command state remains on the
 * server, and no member grants authority to submit an action.
 */
export enum A2uiSurfaceStates
{
	/** Ordered surface operations are still arriving. */
	Streaming = "streaming",
	/** The projected surface is complete enough to accept a displayed action. */
	Ready = "ready",
	/** One displayed action is awaiting authoritative server admission. */
	ActionPending = "action_pending",
	/** The authoritative server accepted the displayed action. */
	Submitted = "submitted",
	/** The server rejected the submitted values as invalid. */
	ValidationError = "validation_error",
	/** The authoritative action path failed without claiming success. */
	ActionFailed = "action_failed",
	/** The server-declared action window has expired. */
	Expired = "expired",
	/** The server reports that the one-use action was already consumed. */
	AlreadyUsed = "already_used",
	/** The current actor is not authorized to use the displayed action. */
	Unauthorized = "unauthorized",
	/** The admitted envelope or component cannot be rendered by this client. */
	Unsupported = "unsupported"
}

/**
 * Exactly eleven component names admitted by the OpenCrane presentation catalogue.
 *
 * The three choice contracts deliberately share upstream MultipleChoice rendering while retaining
 * distinct server-visible names. Adding a value is a display-contract change, not a local styling
 * decision.
 */
export enum A2uiComponentNames
{
	/** Rich text rendered through the injected sanitizer. */
	Text = "Text",
	/** A displayed action trigger that emits an intent only. */
	Button = "Button",
	/** A bounded text entry control. */
	TextField = "TextField",
	/** A one-value choice rendered with the upstream MultipleChoice shape. */
	SingleChoice = "SingleChoice",
	/** A many-value choice rendered with the upstream MultipleChoice shape. */
	MultipleChoice = "MultipleChoice",
	/** A compact selector rendered with the upstream MultipleChoice shape. */
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

/** A scalar allowed to leave the renderer as part of a displayed action intent. */
export type A2uiDisplayedValueScalar = string | number | boolean | null;

/** A bounded displayed value; nested objects and nested arrays are deliberately excluded. */
export type A2uiDisplayedValue = A2uiDisplayedValueScalar | readonly A2uiDisplayedValueScalar[];

/** Safe markdown-to-HTML port supplied by the browser composition root. */
export type A2uiMarkdownSanitizer = (markdown: string) => string | Promise<string>;

/** Display-only projection consumed by one stable A2UI canvas instance. */
export interface A2uiSurfacePresentation
{
	/** Version of the OpenCrane display envelope. */
	readonly version: A2uiEnvelopeVersions.OpenCraneV1;
	/** Conversation coordinate used by the server to reconstruct command authority. */
	readonly conversationId: string;
	/** Run coordinate that fenced the projected surface. */
	readonly runId: string;
	/** Message coordinate that displayed the surface. */
	readonly messageId: string;
	/** Stable A2UI surface identity shared by every contained operation. */
	readonly surfaceId: string;
	/** Monotonic envelope sequence used to reject duplicate or stale projection updates. */
	readonly sequence: number;
	/** Current display lifecycle supplied by the authoritative projection. */
	readonly state: A2uiSurfaceStates;
	/** Ordered, already-decoded upstream A2UI operations for this sequence. */
	readonly operations: readonly Types.ServerToClientMessage[];
	/** Optional display-safe explanation for a non-ready lifecycle. */
	readonly reason?: string;
}

/** Narrow intent emitted after a user activates an action visible on a projected surface. */
export interface A2uiDisplayedActionIntent
{
	/** Version of the OpenCrane display envelope that produced the intent. */
	readonly version: A2uiEnvelopeVersions.OpenCraneV1;
	/** Conversation coordinate copied from the admitted presentation. */
	readonly conversationId: string;
	/** Run coordinate copied from the admitted presentation. */
	readonly runId: string;
	/** Message coordinate copied from the admitted presentation. */
	readonly messageId: string;
	/** Stable surface coordinate copied from the admitted presentation. */
	readonly surfaceId: string;
	/** Sequence of the exact presentation on which the action was displayed. */
	readonly sequence: number;
	/** Displayed action identifier; the server reconstructs authority from this value and coordinates. */
	readonly displayedActionId: string;
	/** Stable component identity that visually emitted the action. */
	readonly sourceComponentId: string;
	/** Bounded scalar values displayed with the action; never raw protocol context or proof material. */
	readonly values: Readonly<Record<string, A2uiDisplayedValue>>;
}
