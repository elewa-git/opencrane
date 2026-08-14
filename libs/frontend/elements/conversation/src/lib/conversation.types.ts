import { AvatarTones } from "@opencrane/elements/ui";

/** Stable visual states for a controlled conversation composer. */
export enum ConversationComposerStates
{
	/** The user may edit and submit the controlled draft. */
	Available = "available",
	/** The host is submitting the exact displayed draft and suppresses duplicates. */
	Submitting = "submitting",
	/** The current conversation state does not accept a message. */
	Disabled = "disabled"
}

/** Stable message treatments that do not imply authority or run state. */
export enum ConversationMessageTones
{
	/** An ordinary participant-authored message. */
	Participant = "participant",
	/** An agent-authored message backed by a run projection. */
	Agent = "agent",
	/** A system-authored notice explaining visible conversation state. */
	System = "system"
}

/** Stable urgency treatments for short conversation status announcements. */
export enum ConversationStatusTones
{
	/** Neutral progress or informational status. */
	Neutral = "neutral",
	/** A state that needs the participant's attention. */
	Attention = "attention",
	/** A successfully completed state. */
	Success = "success",
	/** A failed, cancelled, or restricted state. */
	Danger = "danger"
}

/** Display-safe data for one reusable transcript message. */
export interface ConversationMessagePresentation
{
	/** Stable message coordinate used only for focus and DOM identity. */
	readonly id: string;
	/** Display-safe author name. */
	readonly authorName: string;
	/** Initials shown when an image is not part of the approved presentation. */
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
