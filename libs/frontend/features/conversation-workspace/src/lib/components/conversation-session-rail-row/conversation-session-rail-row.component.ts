import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";

import { ConversationSessionRailIconStates, type ConversationSessionRailItemPresentation } from "../../conversation-workspace-feature.types";

/** Maps each admitted rail state to its PrimeIcon class. */
const _ICON_CLASSES: Readonly<Record<ConversationSessionRailIconStates, string>> =
{
	[ConversationSessionRailIconStates.Completed]: "pi pi-check",
	[ConversationSessionRailIconStates.AgentSession]: "pi pi-sparkles",
	[ConversationSessionRailIconStates.Direct]: "pi pi-user",
	[ConversationSessionRailIconStates.Group]: "pi pi-users",
	[ConversationSessionRailIconStates.Closed]: "pi pi-lock"
};

/** Maps each rail state to the label appended to the row's accessible name. */
const _ICON_LABELS: Readonly<Record<ConversationSessionRailIconStates, string>> =
{
	[ConversationSessionRailIconStates.Completed]: "completed",
	[ConversationSessionRailIconStates.AgentSession]: "Agent session",
	[ConversationSessionRailIconStates.Direct]: "direct chat",
	[ConversationSessionRailIconStates.Group]: "group chat",
	[ConversationSessionRailIconStates.Closed]: "closed"
};

/**
 * Renders a session-rail row as a single-line selection target.
 *
 * The prefix glyph communicates chat type or terminal status while selection only changes the row
 * background. This component emits its presentation item and never navigates, reads state, or
 * interprets onboarding as a conversation coordinate.
 *
 * Called by: `ConversationListComponent` for active and archived session groups.
 */
@Component({ selector: "wo-conversation-session-rail-row", standalone: true, templateUrl: "./conversation-session-rail-row.component.html", styleUrl: "./conversation-session-rail-row.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationSessionRailRowComponent
{
	/** Receives the display-safe session row assigned by the workspace mapper. */
	public readonly item = input.required<ConversationSessionRailItemPresentation>();
	/** Marks whether this row is the current workspace destination. */
	public readonly selected = input(false);
	/** Emits when the participant selects this row. */
	public readonly selectionRequested = output<ConversationSessionRailItemPresentation>();
	/** Exposes the semantic states used by the template's visual modifiers. */
	protected readonly iconStates = ConversationSessionRailIconStates;

	/** Returns the icon class admitted for the mapped rail state. */
	protected iconClass(): string
	{
		return _ICON_CLASSES[this.item().iconState];
	}

	/** Combines the visible title with the meaning otherwise carried by the prefix glyph. */
	protected accessibleName(): string
	{
		return `${this.item().title}, ${_ICON_LABELS[this.item().iconState]}`;
	}

	/** Forwards the selected row without interpreting its coordinates. */
	protected select(): void
	{
		this.selectionRequested.emit(this.item());
	}
}
