import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import { ConversationAssetProvenance } from "@opencrane/state/conversation/assets";

import { __ConversationAssetTypeLabel } from "../conversation-asset-presentation.js";
import { ConversationAssetActionKinds, ConversationAssetPresentationStates, type ConversationAssetActionIntent, type ConversationAssetPresentation } from "../conversation-asset-presentation.types.js";

/** Compact Files-index row backed by one canonical asset reference. */
@Component({
	selector: "wo-conversation-file-row",
	standalone: true,
	imports: [ButtonModule],
	templateUrl: "./conversation-file-row.component.html",
	styleUrl: "./conversation-file-row.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConversationFileRowComponent
{
	public readonly item = input.required<ConversationAssetPresentation>();
	public readonly actionRequested = output<ConversationAssetActionIntent>();
	public readonly states = ConversationAssetPresentationStates;
	public readonly provenance = ConversationAssetProvenance;
	public readonly actions = ConversationAssetActionKinds;

	public typeLabel(): string { const item = this.item(); return __ConversationAssetTypeLabel(item.displayName, item.mediaType); }
	public act(kind: ConversationAssetActionKinds): void { this.actionRequested.emit({ kind, assetId: this.item().id }); }
}
