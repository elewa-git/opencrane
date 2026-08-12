import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import { ConversationMessageComponent, ConversationRichTextComponent } from "@opencrane/elements/conversation";

import type { ConversationMessageView, ConversationOnboardingHistoryPresentation } from "../conversation-workspace-feature.types.js";

/** Read-only completed onboarding exchange rendered inside the normal workspace. */
@Component({ selector: "wo-conversation-onboarding-history", standalone: true, imports: [ButtonModule, ConversationMessageComponent, ConversationRichTextComponent], templateUrl: "./conversation-onboarding-history.component.html", styleUrl: "./conversation-onboarding-history.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationOnboardingHistoryComponent
{
	/** Display-safe heading and completion details. */
	public readonly presentation = input.required<ConversationOnboardingHistoryPresentation>();
	/** Server-ordered read-only transcript rows. */
	public readonly messages = input.required<readonly ConversationMessageView[]>();
	/** Requests the existing new-conversation flow without changing this history. */
	public readonly newChatRequested = output<void>();
}
