import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import { AvatarCircleComponent, AvatarSizes, OpenCraneBrandAppearances, OpenCraneBrandComponent } from "@opencrane/elements/ui";

import { type ConversationRailIdentityPresentation, type ConversationSessionRailItemPresentation, type ConversationSessionRailSelectionIntent } from "../../conversation-workspace-feature.types";
import { ConversationSessionRailRowComponent } from "../conversation-session-rail-row/conversation-session-rail-row.component";

/**
 * Draws the workspace rail as one participant-facing session list.
 *
 * Completed onboarding remains a separate read-only server projection, but this component presents
 * it as the Welcome session beside ordinary conversations. It never turns the onboarding key into a
 * conversation route coordinate or gives it archive, run, or composer controls.
 *
 * Called by: `ConversationWorkspacePageComponent`.
 */
@Component({ selector: "wo-conversation-list", standalone: true, imports: [AvatarCircleComponent, ButtonModule, ConversationSessionRailRowComponent, OpenCraneBrandComponent], templateUrl: "./conversation-list.component.html", styleUrl: "./conversation-list.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationListComponent
{
	/** Completed onboarding and ordinary conversation rows in display order. */
	public readonly items = input<readonly ConversationSessionRailItemPresentation[]>([]);
	/** Browser key of the selected row, or `null` when no session is open. */
	public readonly selectedKey = input<string | null>(null);
	/** Generic directory-derived self label for the optional rail footer. */
	public readonly identity = input<ConversationRailIdentityPresentation | null>(null);
	/** Fires when the participant asks to open the existing mode-choice dialog. */
	public readonly createRequested = output<void>();
	/** Reports the selected server-backed source without navigating or reading state. */
	public readonly itemSelected = output<ConversationSessionRailSelectionIntent>();
	/** Shared avatar size used by the self-label footer. */
	protected readonly identityAvatarSize = AvatarSizes.Medium;
	/** Full wordmark treatment used by persistent application navigation. */
	protected readonly brandAppearance = OpenCraneBrandAppearances.Navigation;

	/** Forward one row's typed source coordinates to the routed page. */
	protected select(item: ConversationSessionRailItemPresentation): void
	{
		this.itemSelected.emit({ kind: item.kind, conversationId: item.conversationId });
	}
}
