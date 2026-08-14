import { AvatarTones } from "@opencrane/elements/ui";

/**
 * Which of three composer appearances the host wants: editable, mid-send, or refusing input.
 *
 * The host decides and passes one value in. The composer never moves itself between these states,
 * so a host that forgets to switch to `Submitting` while its send is in flight will let the same
 * draft be sent twice. Both pages that use the composer derive the value the same way: `Submitting`
 * while their store reports a send in flight, otherwise `Available` only while the conversation
 * still accepts writes.
 *
 * The values stay in memory. No template writes them into the DOM and nothing stores or sends them,
 * so a member can be renamed without a migration or an API change.
 * @see ConversationComposerComponent
 * @see ConversationWorkspacePresenter for how the workspace page picks a value.
 */
export enum ConversationComposerStates
{
	/** The user can type and send. This is the only state in which the composer emits `submitted`. */
	Available = "available",
	/** The host is sending the draft it already has. The textarea is disabled and the send button shows a spinner, so the same text cannot be sent again while the request is out. */
	Submitting = "submitting",
	/** The conversation will not take a message right now — it is closed, unavailable, or reconnecting. The transcript stays readable; only input stops. */
	Disabled = "disabled"
}

/**
 * Which visual treatment a transcript row gets from who wrote it: a participant, an Agent, or
 * OpenCrane itself.
 *
 * Holding a tone grants nothing. A feature mapper picks it from display information only and never
 * uses it to decide what the reader may see or do; the workspace mapper keeps display authorship
 * apart from identity on purpose, which is why an unknown human becomes `Participant 2` rather than
 * a name.
 *
 * The value reaches the DOM as `data-tone` and `conversation-message.component.scss` selects on it
 * (`[data-tone="agent"]`, `[data-tone="system"]`), so changing a string here means editing that
 * stylesheet in the same commit. Nothing stores or transmits the value.
 * @see ConversationMessagePresentation
 */
export enum ConversationMessageTones
{
	/** A human in the conversation wrote this row. It says nothing about which human: the workspace mapper labels people `You` or `Participant N`. */
	Participant = "participant",
	/** An Agent wrote this row and a run projection stands behind it. The stylesheet gives it its own bubble background. */
	Agent = "agent",
	/** OpenCrane wrote this row to explain something about the conversation itself. Rendered muted; it is not part of the participants' exchange. */
	System = "system"
}

/**
 * How urgent a one-line conversation status is, which picks the colour of its indicator dot.
 *
 * A feature mapper translates a run or delivery state into one of these; the status element does no
 * interpreting of its own. The tone is decoration for a message the reader is already given in
 * words, so nothing branches on it beyond styling.
 *
 * The value reaches the DOM as `data-tone` and `conversation-status-line.component.scss` selects on
 * it, so renaming a string means editing that stylesheet too. `Neutral` has no selector of its own
 * and falls through to the default dot colour.
 * @see ConversationStatusPresentation
 */
export enum ConversationStatusTones
{
	/** Work is under way or the line is purely informational. Nothing is wrong and nothing is finished. */
	Neutral = "neutral",
	/** The participant has to do something before this moves on, such as answer a question. */
	Attention = "attention",
	/** The thing the line describes finished and did what was asked. */
	Success = "success",
	/** The thing failed, was cancelled, or was refused. The reader may have lost work and should read the detail line. */
	Danger = "danger"
}

/** Display-safe data for one reusable transcript message. */
export interface ConversationMessagePresentation
{
	/** Stable message coordinate used only for focus and DOM identity. */
	readonly id: string;
	/** Display-safe author name. */
	readonly authorName: string;
	/** One or two letters drawn inside the author's avatar. The shared avatar element takes no image input at all, so these are always what the reader sees. */
	readonly authorInitials: string;
	/** Semantic palette treatment for the author avatar. */
	readonly avatarTone: AvatarTones;
	/** Preformatted, display-safe time label. */
	readonly timestampLabel: string;
	/** Plain message copy; rich content belongs in the named projection slot. */
	readonly body: string;
	/** Visual authorship treatment without authority meaning. */
	readonly tone: ConversationMessageTones;
	/** Optional screen-reader suffix such as edited or delivered. */
	readonly accessibleStatus?: string;
}

/** Display-safe data for one short live-region status row. */
export interface ConversationStatusPresentation
{
	/** Short status heading. */
	readonly label: string;
	/** Optional plain-language explanation. */
	readonly detail?: string;
	/** Semantic urgency treatment. */
	readonly tone: ConversationStatusTones;
	/** Whether assistive technology should announce the change assertively. */
	readonly assertive?: boolean;
}

/**
 * One message's rich body, already turned into HTML that is safe to put in the page.
 *
 * A conversation feature mapper builds this and the rich-text element only displays it, so the
 * mapper owns the safety of `html`. The workspace mapper builds one for every transcript row and
 * every live streaming message, running the message text through the DOMPurify-backed renderers in
 * `@opencrane/state/conversation/render`.
 * @see ConversationRichTextComponent
 */
export interface ConversationRichTextPresentation
{
	/** Says which message this body belongs to. The element writes it out as `data-message-id` so the page can find and focus the row; nothing is fetched with it. */
	readonly messageId: string;
	/** HTML the mapper has already sanitized. The element binds it to `innerHTML` unchanged, so a string that skipped `toSanitizedMarkdownHtml` or `toStreamingMarkdownHtml` reaches the page as written. */
	readonly html: string;
	/** Plain-language name for the block, used as its `aria-label` so a screen reader can say whose message it is before reading the markup. */
	readonly label: string;
}

/**
 * What the participant may currently do about the Agent run they are watching, and what to call its
 * state.
 *
 * The workspace presenter builds this from the run store's own checks and the element renders one
 * control per allowed action. The three permission flags decide whether a control is rendered at
 * all, and `busy` decides whether the rendered controls accept a click. None of them is a security
 * check: the server authorizes every run command again when the host sends it.
 * @see ConversationRunActionsComponent
 */
export interface ConversationRunActionsPresentation
{
	/** Participant-facing name of the run state, already translated from the run lifecycle enum by the presenter — for example `Run queued` or `Run failed`. The element prints it in a `role="status"` region. */
	readonly statusLabel: string;
	/** True while cancelling still makes sense, meaning the run has not completed, failed, or been cancelled. It renders the Cancel run button, whose intent asks the host to cancel the attempt the participant can see rather than whichever attempt is newest. */
	readonly canCancel: boolean;
	/** True only when the run ended in failure, so a fresh attempt can be started. When false the Retry run button is not rendered. */
	readonly canRetry: boolean;
	/** True while the run is live enough to take guidance, which renders the steering field and its Steer button. It does not promise a submission would be accepted now: the button stays disabled until the draft has text. */
	readonly canSteer: boolean;
	/** True while one run command — steer, cancel, or retry — is still in flight. Every rendered control is disabled meanwhile, which is what keeps a second cancel from racing the first. */
	readonly busy: boolean;
}
