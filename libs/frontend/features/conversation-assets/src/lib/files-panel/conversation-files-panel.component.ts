import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";

import { ConversationAssetProvenance } from "@opencrane/state/conversation/assets";

import { ConversationFileRowComponent } from "../file-row/conversation-file-row.component";
import type { ConversationAssetActionIntent, ConversationAssetPresentation } from "../conversation-asset-presentation.types";

/** Grouped Files index; every row remains a link to its canonical source. */
@Component({
	selector: "wo-conversation-files-panel",
	standalone: true,
	imports: [ConversationFileRowComponent],
	templateUrl: "./conversation-files-panel.component.html",
	styleUrl: "./conversation-files-panel.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConversationFilesPanelComponent
{
	public readonly items = input<readonly ConversationAssetPresentation[]>([]);
	public readonly actionRequested = output<ConversationAssetActionIntent>();
	public readonly participantFiles = computed(() => this.items().filter(item => item.provenance === ConversationAssetProvenance.ParticipantUpload));
	public readonly agentFiles = computed(() => this.items().filter(item => item.provenance === ConversationAssetProvenance.AgentOutput));

	/** Re-emit a row intent to the workspace state owner. */
	public request(intent: ConversationAssetActionIntent): void { this.actionRequested.emit(intent); }
}
