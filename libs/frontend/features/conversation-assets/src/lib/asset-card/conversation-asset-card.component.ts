import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import { ConversationAssetDisposition, ConversationAssetProvenance } from "@opencrane/state/conversation/assets";

import { __ConversationAssetByteLabel, __ConversationAssetTypeLabel } from "../conversation-asset-presentation";
import { ConversationAssetActionKinds, ConversationAssetPresentationStates, type ConversationAssetActionIntent, type ConversationAssetPresentation } from "../conversation-asset-presentation.types";

/** Transcript asset card for participant uploads and durable assistant output. */
@Component({
	selector: "wo-conversation-asset-card",
	standalone: true,
	imports: [ButtonModule],
	templateUrl: "./conversation-asset-card.component.html",
	styleUrl: "./conversation-asset-card.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConversationAssetCardComponent
{
	public readonly item = input.required<ConversationAssetPresentation>();
	public readonly actionRequested = output<ConversationAssetActionIntent>();
	public readonly states = ConversationAssetPresentationStates;
	public readonly dispositions = ConversationAssetDisposition;
	public readonly provenance = ConversationAssetProvenance;

	public typeLabel(): string { const item = this.item(); return __ConversationAssetTypeLabel(item.displayName, item.mediaType); }
	public byteLabel(): string { return __ConversationAssetByteLabel(this.item().byteLength); }
	public act(kind: ConversationAssetActionKinds): void { this.actionRequested.emit({ kind, assetId: this.item().id }); }
	public readonly actions = ConversationAssetActionKinds;
}
