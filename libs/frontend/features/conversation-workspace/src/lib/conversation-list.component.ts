import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import type { ConversationSummaryPresentation } from "./conversation-workspace-feature.types.js";

/** Feature-local conversation rail for selection and new-conversation intent. */
@Component({ selector: "wo-conversation-list", standalone: true, imports: [ButtonModule], templateUrl: "./conversation-list.component.html", styleUrl: "./conversation-list.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationListComponent
{
	/** Privacy-safe conversation rows. */
	public readonly items = input<readonly ConversationSummaryPresentation[]>([]);
	/** Currently selected conversation coordinate. */
	public readonly selectedId = input<string | null>(null);
	/** Emits a request to show immutable-mode creation choices. */
	public readonly createRequested = output<void>();
	/** Emits one selected opaque conversation coordinate. */
	public readonly selected = output<string>();
}
