import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import { __ConversationAssetTypeLabel } from "../conversation-asset-presentation.js";
import { ConversationAssetActionKinds, ConversationAssetPresentationStates, type ConversationAssetActionIntent, type ConversationAssetPresentation } from "../conversation-asset-presentation.types.js";

/** One compact composer attachment state with parent-owned actions. */
@Component({
	selector: "wo-conversation-attachment-chip",
	standalone: true,
	imports: [ButtonModule],
	templateUrl: "./conversation-attachment-chip.component.html",
	styleUrl: "./conversation-attachment-chip.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConversationAttachmentChipComponent
{
	public readonly item = input.required<ConversationAssetPresentation>();
	public readonly actionRequested = output<ConversationAssetActionIntent>();
	public readonly states = ConversationAssetPresentationStates;

	/** Short supported file type. */
	public typeLabel(): string { const item = this.item(); return __ConversationAssetTypeLabel(item.displayName, item.mediaType); }

	/** Emit one exact retry intent. */
	public retry(): void { this._emit(ConversationAssetActionKinds.Retry); }

	/** Emit one pre-admission or server-authorized removal intent. */
	public remove(): void { this._emit(ConversationAssetActionKinds.Remove); }

	/** Emit one typed parent-owned action. */
	private _emit(kind: ConversationAssetActionKinds): void { this.actionRequested.emit({ kind, assetId: this.item().id }); }
}
