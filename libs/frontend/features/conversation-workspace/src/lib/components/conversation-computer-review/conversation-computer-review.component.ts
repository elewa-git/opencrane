import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { InputTextModule } from "primeng/inputtext";

import type { ConversationComputerBrowserTarget, ConversationComputerCommandResult } from "@opencrane/state/conversation/workspace";
import type { ConversationComputerLocalhostIntent } from "./conversation-computer-review.types";
export type { ConversationComputerLocalhostIntent } from "./conversation-computer-review.types";

/**
 * Presents active-computer review output without owning transport or sandbox coordinates.
 *
 * The component emits participant inputs to its workspace owner. It displays localhost responses as
 * source text and accepts argv fields rather than shell text, leaving authorization, allowlists, and
 * execution to the server-backed store.
 *
 * Called by: `ConversationWorkspaceContextPanelComponent` when the selected conversation has a
 * computer generation available for review.
 */
@Component({ selector: "wo-conversation-computer-review", standalone: true, imports: [ButtonModule, InputTextModule], templateUrl: "./conversation-computer-review.component.html", styleUrl: "./conversation-computer-review.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationComputerReviewComponent
{
	/** Whether an operation is active. */
	public readonly busy = input(false);
	/** Fixed display-safe request failure. */
	public readonly error = input<string | null>(null);
	/** Selected file contents. */
	public readonly file = input("");
	/** Selected file diff. */
	public readonly diff = input<ConversationComputerCommandResult | null>(null);
	/** Last command result. */
	public readonly command = input<ConversationComputerCommandResult | null>(null);
	/** Private browser pages. */
	public readonly browserTargets = input<readonly ConversationComputerBrowserTarget[]>([]);
	/** Revocable screenshot URL. */
	public readonly screenshotUrl = input<string | null>(null);
	/** Inert localhost preview source. */
	public readonly preview = input("");
	/** Requests file and diff inspection. */
	public readonly inspectRequested = output<string>();
	/** Requests one argv-only command. */
	public readonly commandRequested = output<readonly string[]>();
	/** Requests browser target discovery. */
	public readonly browserRefreshRequested = output<void>();
	/** Requests opening one localhost page. */
	public readonly pageRequested = output<ConversationComputerLocalhostIntent>();
	/** Requests one localhost screenshot. */
	public readonly screenshotRequested = output<ConversationComputerLocalhostIntent>();
	/** Requests one localhost preview response. */
	public readonly previewRequested = output<ConversationComputerLocalhostIntent>();

	/** Emit a trimmed relative file path. */
	protected inspect(path: string): void
	{
		if (path.trim())
			this.inspectRequested.emit(path.trim());
	}
	/** Split a bounded command line without invoking a shell. */
	protected run(value: string): void
	{
		const argv = value.trim().split(/\s+/).filter(Boolean);
		if (argv.length > 0)
			this.commandRequested.emit(argv);
	}
	/** Emit a checked localhost coordinate from controlled fields. */
	protected localhost(port: string, path: string, kind: "page" | "preview" | "screenshot"): void
	{
		const intent = { port: Number(port), path: path.trim() || "/" };
		if (!Number.isInteger(intent.port))
			return;
		if (kind === "page")
			this.pageRequested.emit(intent);
		if (kind === "preview")
			this.previewRequested.emit(intent);
		if (kind === "screenshot")
			this.screenshotRequested.emit(intent);
	}
}
