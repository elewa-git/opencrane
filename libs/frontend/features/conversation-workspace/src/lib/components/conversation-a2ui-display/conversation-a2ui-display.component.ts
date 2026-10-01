import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { Catalog, MessageProcessor, Surface, Theme } from "@a2ui/angular/v0_8";
import { ResourceFeedbackComponent } from "@opencrane/elements/ui";

import { ConversationA2uiDisplayStates, type ConversationA2uiDisplayPresentation } from "../../a2ui/conversation-a2ui-display.types";
import { _ConversationA2uiDisplayCatalog } from "./conversation-a2ui-display.catalogue";
import { _CreateConversationA2uiDisplayTheme } from "./conversation-a2ui-display.theme";

/**
 * Displays the workspace's validated result without replaying messages or accepting user actions.
 * The mapper must resolve text bindings and reject unsupported nodes before supplying Ready.
 * Waiting and Unavailable remove the old result from the DOM; they never retain stale content.
 * Called by: ConversationWorkspaceTranscriptComponent through its structured display row.
 */
@Component({ selector: "wo-conversation-a2ui-display", standalone: true, imports: [Surface, ResourceFeedbackComponent], providers: [MessageProcessor, { provide: Catalog, useFactory: _ConversationA2uiDisplayCatalog }, { provide: Theme, useFactory: _CreateConversationA2uiDisplayTheme }], templateUrl: "./conversation-a2ui-display.component.html", styleUrl: "./conversation-a2ui-display.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationA2uiDisplayComponent
{
	/** Validated display from authorized history; no raw payload or action coordinates are accepted. */
	public readonly presentation = input.required<ConversationA2uiDisplayPresentation>();
	/** States whose visible meanings belong to the workspace's display projection. */
	protected readonly states = ConversationA2uiDisplayStates;
}
