import { Injectable, Signal, computed, inject, resource, signal } from "@angular/core";
import { ModelProvider, PROVIDER_KEY_GATEWAY, ProviderKeyStatus } from "@opencrane/state/provider-key/adapter";
import { SessionStore } from "@opencrane/state/core";
import type { ModelKeyRow } from "../model-keys-admin.types";
import { _ToModelKeyRows } from "../model-keys-admin.utils";

/** Owns write-only key drafts, permission-gated reads and per-provider commands for one route. */
@Injectable()
export class ModelKeysAdminStore
{
	/** Active BYOK provider-key data source (live OpenCrane when bound). */
	private readonly _gateway = inject(PROVIDER_KEY_GATEWAY);

	/** App-wide session/identity (drives the admin capability gate). */
	private readonly _session = inject(SessionStore);

	/** Whether the current session may administer provider keys. */
	public readonly canAdminister = computed(() => this._session.capabilities().customerAdmin);

	/** Per-provider key status (write-only: never carries key material). */
	private readonly _keys = resource({
		params: this.canAdminister,
		loader: this._Load.bind(this)
	});

	/** Draft key input per provider, edited locally before submit then cleared. */
	private readonly _drafts = signal<Record<string, string>>({});

	/** Providers whose write or removal command is pending. */
	public readonly busy = signal<ReadonlySet<ModelProvider>>(new Set());

	/** Last error message, or null when the most recent action succeeded. */
	public readonly error = signal<string | null>(null);

	/** Every supported provider as a row (unconfigured providers included). */
	public readonly rows: Signal<ModelKeyRow[]> = computed((): ModelKeyRow[] =>
	{
		return _ToModelKeyRows(this._keys.hasValue() ? this._keys.value() : []);
	});

	/** Number of providers with a configured key, for the heading subtitle. */
	public readonly configuredCount: Signal<number> = computed((): number =>
	{
		return this.rows().filter(function isConfigured(row: ModelKeyRow): boolean { return row.configured; }).length;
	});

	/** Current draft key for a provider's input (empty when untouched). */
	public draft(provider: ModelProvider): string
	{
		return this._drafts()[provider] ?? "";
	}

	/** Whether a write/remove is in flight for a provider's row. */
	public isBusy(provider: ModelProvider): boolean
	{
		return this.busy().has(provider);
	}

	/** Record an edit to a provider's draft key input. */
	public setDraft(provider: ModelProvider, value: string): void
	{
		this._drafts.update(function applyEdit(current: Record<string, string>): Record<string, string>
		{
			return { ...current, [provider]: value };
		});
	}

	/** Submit a provider's draft key (PUT), clear the input, then reload the list. */
	public async submit(provider: ModelProvider): Promise<void>
	{
		const draft = this.draft(provider);
		const apiKey = draft.trim();
		if (apiKey.length === 0 || this.busy().has(provider) || !this.canAdminister())
		{
			return;
		}
		this.error.set(null);
		this.busy.update(current => new Set([...current, provider]));
		try
		{
			await this._gateway.setKey(provider, apiKey);
			if (this.draft(provider) === draft)
				this._clearDraft(provider);
			this._keys.reload();
		}
		catch
		{
			this.error.set("The provider key change could not be saved. Try again.");
		}
		finally
		{
			this._Finish(provider);
		}
	}

	/** Remove a provider's key and reload on success. */
	public async remove(provider: ModelProvider): Promise<void>
	{
		if (this.busy().has(provider) || !this.canAdminister())
			return;
		const draft = this.draft(provider);
		this.error.set(null);
		this.busy.update(current => new Set([...current, provider]));
		try
		{
			await this._gateway.deleteKey(provider);
			if (this.draft(provider) === draft)
				this._clearDraft(provider);
			this._keys.reload();
		}
		catch
		{
			this.error.set("The provider key change could not be saved. Try again.");
		}
		finally
		{
			this._Finish(provider);
		}
	}

	/** Drop a provider's draft input value. */
	private _clearDraft(provider: ModelProvider): void
	{
		this._drafts.update(function dropProvider(current: Record<string, string>): Record<string, string>
		{
			const next = { ...current };
			delete next[provider];
			return next;
		});
	}

	/** Distinguishes a pending status read from providers without configured keys. */
	public readonly loading = this._keys.isLoading;
	/** Exposes a status-read failure separately from command failures. */
	public readonly readError = computed(() => this._keys.error() ? "Provider keys could not be refreshed. Try again." : null);
	/** Retries the status read without resubmitting any key. */
	public refresh(): void { this._keys.reload(); }
	/** Avoids protected reads when the browser already knows administration is unavailable. */
	private _Load(): Promise<ProviderKeyStatus[]> { return this.canAdminister() ? this._gateway.list() : Promise.resolve([]); }
	/** Releases this provider without clearing another provider's pending command. */
	private _Finish(provider: ModelProvider): void
	{
		this.busy.update(function _Release(current) { const next = new Set(current); next.delete(provider); return next; });
	}
}
