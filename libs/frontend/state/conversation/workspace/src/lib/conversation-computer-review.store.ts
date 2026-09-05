import { Injectable, inject, signal } from "@angular/core";

import { CONVERSATION_COMPUTER_REVIEW_GATEWAY } from "./conversation-workspace.gateway";
import type { ConversationComputerBrowserTarget, ConversationComputerCommandResult, ConversationComputerReviewGateway } from "./conversation-workspace.types";

/**
 * Owns active-computer review requests for the selected conversation.
 *
 * The store retains display output while a selection is current, then revokes screenshot URLs and
 * clears every result when either the conversation or computer generation changes. Its generation
 * counter also discards late responses, preventing output from the previous computer from appearing
 * under the newly selected one.
 *
 * Called by: `ConversationWorkspacePresenter` and `ConversationWorkspacePageComponent`; the page
 * provides one instance for its routed workspace.
 */
@Injectable()
export class ConversationComputerReviewStore
{
	/** Authenticated public API port. */
	private readonly _gateway = inject(CONVERSATION_COMPUTER_REVIEW_GATEWAY);
	/** Selected conversation, never a sandbox coordinate. */
	private readonly _conversationId = signal<string | null>(null);
	/** Public logical-computer generation key used only to invalidate stale review output. */
	private _computerGenerationKey: string | null = null;
	/** Increments on selection changes so late results are ignored. */
	private _generation = 0;
	/** Whether one review operation is active. */
	public readonly busy = signal(false);
	/** Fixed display-safe failure text. */
	public readonly error = signal<string | null>(null);
	/** Last selected file body. */
	public readonly file = signal("");
	/** Last selected file diff. */
	public readonly diff = signal<ConversationComputerCommandResult | null>(null);
	/** Last explicit command result. */
	public readonly command = signal<ConversationComputerCommandResult | null>(null);
	/** Current private browser targets. */
	public readonly browserTargets = signal<readonly ConversationComputerBrowserTarget[]>([]);
	/** Revocable URL for the last PNG screenshot. */
	public readonly screenshotUrl = signal<string | null>(null);
	/** Last localhost preview rendered as inert text. */
	public readonly preview = signal("");

	/** Select one conversation and remove all retained review output. */
	public select(conversationId: string | null, computerGenerationKey: string | null = null): void
	{
		if (this._conversationId() === conversationId && this._computerGenerationKey === computerGenerationKey)
			return;
		this._conversationId.set(conversationId);
		this._computerGenerationKey = computerGenerationKey;
		this._generation += 1;
		this.file.set("");
		this.diff.set(null);
		this.command.set(null);
		this.browserTargets.set([]);
		this.preview.set("");
		this.error.set(null);
		this.busy.set(false);
		const url = this.screenshotUrl();
		if (url !== null)
			URL.revokeObjectURL(url);
		this.screenshotUrl.set(null);
	}

	/** Load one file and its diff using Read-authorized review calls. */
	public async inspect(path: string): Promise<void>
	{
		const conversationId = this._conversationId();
		if (conversationId === null || !path.trim())
			return;
		await this._Run(async function _Inspect(gateway) { const values = await Promise.all([gateway.readComputerFile(conversationId, path), gateway.readComputerDiff(conversationId, path)]); return values; }, function _Adopt(store, values) { store.file.set(values[0]); store.diff.set(values[1]); });
	}

	/** Run one argv-only release-allowlisted command. */
	public async run(argv: readonly string[]): Promise<void>
	{
		const conversationId = this._conversationId();
		if (conversationId === null || argv.length === 0)
			return;
		await this._Run(function _Command(gateway) { return gateway.runComputerCommand(conversationId, argv, "."); }, function _Adopt(store, value) { store.command.set(value); });
	}

	/** Refresh the private browser target list. */
	public async refreshBrowser(): Promise<void>
	{
		const conversationId = this._conversationId();
		if (conversationId === null)
			return;
		await this._Run(function _Targets(gateway) { return gateway.listComputerBrowserTargets(conversationId); }, function _Adopt(store, value) { store.browserTargets.set(value); });
	}

	/** Open one allowlisted localhost page and adopt the refreshed target list. */
	public async openPage(port: number, path: string): Promise<void>
	{
		const conversationId = this._conversationId();
		if (conversationId === null)
			return;
		await this._Run(async function _Page(gateway) { await gateway.openComputerBrowserPage(conversationId, port, path); return gateway.listComputerBrowserTargets(conversationId); }, function _Adopt(store, value) { store.browserTargets.set(value); });
	}

	/** Capture one bounded PNG from an allowlisted localhost page. */
	public async screenshot(port: number, path: string): Promise<void>
	{
		const conversationId = this._conversationId();
		if (conversationId === null)
			return;
		await this._Run(function _Screenshot(gateway) { return gateway.captureComputerScreenshot(conversationId, port, path, 1280, 720); }, function _Adopt(store, value)
		{
			const previous = store.screenshotUrl();
			if (previous !== null)
				URL.revokeObjectURL(previous);
			store.screenshotUrl.set(URL.createObjectURL(value));
		});
	}

	/** Read one allowlisted localhost response as inert source text. */
	public async loadPreview(port: number, path: string): Promise<void>
	{
		const conversationId = this._conversationId();
		if (conversationId === null)
			return;
		await this._Run(function _Preview(gateway) { return gateway.readComputerPreview(conversationId, port, path); }, function _Adopt(store, value) { store.preview.set(value); });
	}

	/** Sequence one operation and reject its result after a scope change. */
	private async _Run<T>(operation: (gateway: ConversationComputerReviewGateway) => Promise<T>, adopt: (store: ConversationComputerReviewStore, value: T) => void): Promise<void>
	{
		if (this.busy())
			return;
		const generation = this._generation;
		this.busy.set(true);
		this.error.set(null);
		try
		{
			const value = await operation(this._gateway);
			if (generation === this._generation)
				adopt(this, value);
		}
		catch
		{
			if (generation === this._generation)
				this.error.set("Computer review is temporarily unavailable.");
		}
		finally
		{
			if (generation === this._generation)
				this.busy.set(false);
		}
	}
}
