import { ResourceBoundaryKind } from "./boundary.types";

/** Kinds of cards an assistant message can contain. */
export enum MessageCardKind
{
	/** Rendered prose (Markdown, via the vendored render pipeline). */
	Text = "text",
	/** Assistant reasoning ("thinking") stream — rendered dim and collapsible. */
	Thinking = "thinking",
	/** A tool call the agent made — rendered as a collapsible card (input/output/error). */
	Tool = "tool",
	/** A file/media attachment (image/audio/video/document) surfaced in a reply. */
	Attachment = "attachment",
	/** A rich agent-authored surface (A2UI canvas), rendered in-process. */
	Canvas = "canvas",
	/** Grounded observation ledger entry. */
	Observation = "observation",
	/** Applied policy ledger entry. */
	Policy = "policy",
	/** Performed action ledger entry. */
	Action = "action",
	/** Approval request card. */
	Decide = "decide",
	/** Generated image card. */
	Image = "image"
}

/** One card inside a message. */
export interface MessageCard
{
	/** Card kind discriminator. */
	type: MessageCardKind;
	/** Prose content (text cards). */
	content?: string;
	/** Ledger entry id (e.g. "R1", "P1", "A1"). */
	id?: string;
	/** Resource boundary kind of the ledger entry. */
	boundaryKind?: ResourceBoundaryKind;
	/** Ledger entry label. */
	label?: string;
	/** Source reference (file, policy id, canvas). */
	ref?: string;
	/** Entry status (e.g. "applied", "done", "pending"); also the tool run status. */
	status?: string;
	/** Question for decide cards. */
	question?: string;
	/** Image URL (image cards). */
	imageUrl?: string;
	/** Image alt text (image cards). */
	imageAlt?: string;
	/** Generation prompt caption (image cards). */
	imagePrompt?: string;
	/** Tool output text (tool cards) — rendered as a fenced block in the expanded card. */
	output?: string;
	/** Whether a tool card's result is an error (drives error styling). */
	isError?: boolean;
	/** Attachment URL (attachment cards). */
	attachmentUrl?: string;
	/** Attachment media family (attachment cards). */
	attachmentKind?: "image" | "audio" | "video" | "document";
	/** Attachment display label (attachment cards). */
	attachmentLabel?: string;
	/** Attachment MIME type, when known (attachment cards). */
	mimeType?: string;
	/** Whether an audio attachment is a voice note (attachment cards). */
	isVoiceNote?: boolean;
	/** Canvas (A2UI) surface URL (canvas cards). */
	canvasUrl?: string;
	/** Canvas title (canvas cards). */
	canvasTitle?: string;
	/** Canvas preferred height in px (canvas cards). */
	canvasHeight?: number;
	/** Canvas view id (canvas cards). */
	canvasViewId?: string;
	/** In-process A2UI payload (canvas cards): JSONL / array / parsed actions, rendered in-app. */
	canvasMessages?: unknown;
}

/**
 * How an assistant turn ended — derived from the gateway `stopReason`.
 *
 * Lets the UI tell a clean reply apart from a truncated or errored one, which the
 * gateway otherwise renders identically.
 */
export enum MessageDelivery
{
	/** Completed cleanly ("stop"). */
	Ok = "ok",
	/** Cut off at the model's output limit ("length"). */
	Truncated = "truncated",
	/** The run errored before finishing ("error"). */
	Error = "error"
}

/** A single message in a thread. */
export interface ThreadMessage
{
	/** Stable message id. */
	id: string;
	/** Sender role ("user" | "assistant"). */
	role: string;
	/** Human author name (user messages). */
	author?: string;
	/** Display timestamp (HH:mm). */
	time: string;
	/** Ordered cards making up the message body. */
	cards: MessageCard[];
	/**
	 * How the turn ended (assistant messages). Absent while streaming and for a
	 * clean {@link MessageDelivery.Ok} reply; set to Truncated/Error so the UI can
	 * surface a distinct badge.
	 */
	delivery?: MessageDelivery;
}

/** A selectable model from the pod catalogue (`models.list`). */
export interface ModelOption
{
	/** Model id (used as the reference the agent runs). */
	id: string;
	/** Human-readable label. */
	name: string;
	/** Provider that serves the model, when known. */
	provider?: string;
}

/** A selectable agent from the pod catalogue (`agents.list`). */
export interface AgentOption
{
	/** Agent id (passed as `agentId` on `chat.send`/`chat.abort`). */
	id: string;
	/** Human-readable label. */
	name: string;
}

/** A conversation thread with its header metadata. */
export interface ThreadData
{
	/** Thread title (shown as #title). */
	title: string;
	/** Whether the pod is in sync with the fleet contract. */
	synced: boolean;
	/** Owning pod id. */
	pod: string;
	/** Department label. */
	dept: string;
	/** Department accent colour. */
	deptColor: string;
	/** Active awareness-contract version. */
	contractVersion: string;
	/** Messages in chronological order. */
	messages: ThreadMessage[];
}
