import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";

import { ConversationAttachmentChipComponent } from "../attachment-chip/conversation-attachment-chip.component.js";
import { ConversationAssetPresentationStates, type ConversationAssetActionIntent, type ConversationAssetPresentation } from "../conversation-asset-presentation.types.js";

/** Composer tray that announces upload changes and re-emits typed chip intents. */
@Component({
	selector: "wo-conversation-attachment-tray",
	standalone: true,
	imports: [ConversationAttachmentChipComponent],
	templateUrl: "./conversation-attachment-tray.component.html",
	styleUrl: "./conversation-attachment-tray.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConversationAttachmentTrayComponent
{
	public readonly items = input<readonly ConversationAssetPresentation[]>([]);
	public readonly actionRequested = output<ConversationAssetActionIntent>();
	public readonly readyCount = computed(() => this.items().filter(item => item.state === ConversationAssetPresentationStates.Ready).length);

	/** Keep parent intent ownership outside presentation. */
	public request(intent: ConversationAssetActionIntent): void { this.actionRequested.emit(intent); }
}
