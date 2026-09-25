import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

import { ScopeChipComponent } from "@opencrane/elements/ui";
import { ConversationActivityKinds, type ConversationActivityRow, type ConversationActivityTarget } from "@opencrane/state/conversation/elicitation";

import { _ConversationActivityElicitationStatus, _ConversationActivityRunStatus, _ConversationActivityToolPhase } from "./conversation-activity-status.mapper";
import { ConversationActivityReadStates } from "./conversation-activity.types";

/**
 * Derived Activity list with explicit canonical deep-link intents.
 *
 * A caller may project one header action, such as the workspace panel's close control. The action
 * remains caller-owned because this component does not know whether it sits in a persistent page,
 * drawer, or collapsible panel.
 */
@Component({ selector: "wo-conversation-activity", standalone: true, imports: [ButtonModule, DatePipe, MessageModule, ScopeChipComponent], templateUrl: "./conversation-activity.component.html", styleUrl: "./conversation-activity.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationActivityComponent
{
	/** Ordered browser-safe derived rows. */
	public readonly rows = input.required<readonly ConversationActivityRow[]>();
	/** Names a bounded recent-work list when it is not the complete activity index. */
	public readonly title = input("Activity");
	/** Separates read progress and failure from durable run status. */
	public readonly readState = input(ConversationActivityReadStates.Ready);
	/** Contains fixed display copy supplied by the owning read store. */
	public readonly error = input<string | null>(null);
	/** Explains an authoritative empty list in the caller's activity scope. */
	public readonly emptyLabel = input("No recent work is visible in this chat.");
	/** Enables status refresh only where a caller owns that read operation. */
	public readonly refreshAvailable = input(false);
	/** Requests only a new status read, never another execution attempt. */
	public readonly refreshRequested = output<void>();
	/** Emits canonical coordinates for workspace-owned navigation. */
	public readonly targetRequested = output<ConversationActivityTarget>();
	/** Stable kind enum used by the template. */
	protected readonly kinds = ConversationActivityKinds;
	/** Makes the finite read states available to the template. */
	protected readonly readStates = ConversationActivityReadStates;
	/** Supplies participant labels and shared chip tones. */
	protected readonly runStatus = _ConversationActivityRunStatus;
	/** Supplies participant-facing request state without exposing protocol labels. */
	protected readonly elicitationStatus = _ConversationActivityElicitationStatus;
	/** Supplies fixed tool-phase copy and semantic tone separately from overall work status. */
	protected readonly toolPhase = _ConversationActivityToolPhase;

	/** Selects the action copy from the row's finite semantic kind. */
	protected targetLabel(row: ConversationActivityRow): string
	{
		switch (row.kind)
		{
			case ConversationActivityKinds.Elicitation: return "Answer";
			case ConversationActivityKinds.ToolFailure: return "Open";
			case ConversationActivityKinds.Run: return "Open answer";
		}
	}
}
