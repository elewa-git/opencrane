import { ChangeDetectionStrategy, Component, Signal, computed, inject, resource, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ConfirmationService } from "primeng/api";
import { ConfirmDialogModule } from "primeng/confirmdialog";

import { ModelProvider, PROVIDER_KEY_GATEWAY, ProviderKeyStatus } from "@opencrane/state/provider-key/adapter";
import { SessionStore } from "@opencrane/state/core";
import { ScopeChipAppearances, ScopeChipComponent, ScopeChipTones, SectionHeadingComponent } from "@opencrane/elements/ui";

import { LITELLM_BADGE_STYLES, ModelKeyRow } from "./model-keys-admin.types";
import { _BadgeFor, _ToModelKeyRows } from "./model-keys-admin.utils";

/**
 * Model Keys — bring-your-own-key (BYOK) provider-key governance.
 *
 * The org admin's source of truth for the upstream model-provider keys this
 * silo uses. Lists every supported provider (configured or not), shows whether
 * each key reached LiteLLM ("active") or only the k8s Secret ("Secret-only"),
 * and lets the admin set/refresh a key (write-only — never shown back) or remove
 * one. Writes go through {@link PROVIDER_KEY_GATEWAY}, then reload the list.
 * Access is gated in-component on {@link SessionStore.capabilities}`().customerAdmin`;
 * the control plane remains the real enforcement point.
 */
@Component({
	selector: "wo-model-keys-admin",
	standalone: true,
	imports: [SectionHeadingComponent, ScopeChipComponent, FormsModule, ConfirmDialogModule],
	providers: [ConfirmationService],
	templateUrl: "./model-keys-admin.component.html",
	styleUrl: "./model-keys-admin.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ModelKeysAdminComponent
{
	/** Shared chip tones exposed for configured and unconfigured summaries. */
	public readonly chipTones = ScopeChipTones;

	/** Shared chip appearances exposed for compact table badges. */
	public readonly chipAppearances = ScopeChipAppearances;

	/** Active BYOK provider-key data source (live OpenCrane when bound). */
	private readonly _gateway = inject(PROVIDER_KEY_GATEWAY);

	/** App-wide session/identity (drives the admin capability gate). */
	private readonly _session = inject(SessionStore);

	/** PrimeNG confirm service (component-scoped) for the remove affordance. */
	private readonly _confirm = inject(ConfirmationService);

	/** Per-provider key status (write-only: never carries key material). */
	private readonly _keys = resource({
		loader: (): Promise<ProviderKeyStatus[]> => this._gateway.list()
	});

	/** Draft key input per provider, edited locally before submit then cleared. */
	private readonly _drafts = signal<Record<string, string>>({});

	/** Provider whose write/remove is currently in flight, or null when idle. */
	private readonly _busyProvider = signal<ModelProvider | null>(null);

	/** Last error message, or null when the most recent action succeeded. */
	public readonly error = signal<string | null>(null);

	/** Whether the session may use the admin console (else a denied state shows). */
	public readonly canAdminister: Signal<boolean> = computed((): boolean => this._session.capabilities().customerAdmin);

	/** LiteLLM badge styles for the template. */
	public readonly badgeStyles = LITELLM_BADGE_STYLES;

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

	/** Resolve a row's LiteLLM badge style (active / Secret-only / not configured). */
	public badgeStyle(row: ModelKeyRow): { label: string; tone: ScopeChipTones }
	{
		return this.badgeStyles[_BadgeFor(row)];
	}

	/** Current draft key for a provider's input (empty when untouched). */
	public draft(provider: ModelProvider): string
	{
		return this._drafts()[provider] ?? "";
	}

	/** Whether a write/remove is in flight for a provider's row. */
	public isBusy(provider: ModelProvider): boolean
	{
		return this._busyProvider() === provider;
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
		const apiKey = this.draft(provider).trim();
		if (apiKey.length === 0)
		{
			return;
		}
		this.error.set(null);
		this._busyProvider.set(provider);
		try
		{
			await this._gateway.setKey(provider, apiKey);
			this._clearDraft(provider);
			this._keys.reload();
		}
		catch (error)
		{
			this.error.set(this._messageOf(error));
		}
		finally
		{
			this._busyProvider.set(null);
		}
	}

	/** Confirm, then remove a provider's key (DELETE) and reload the list. */
	public confirmRemove(row: ModelKeyRow): void
	{
		this._confirm.confirm({
			header: "Remove key",
			message: `Remove the ${row.label} key? Models relying on it stop working until a new key is set.`,
			icon: "pi pi-exclamation-triangle",
			acceptLabel: "Remove",
			rejectLabel: "Cancel",
			accept: () =>
			{
				void this._remove(row.provider);
			}
		});
	}

	/** Remove a provider's key and reload on success. */
	private async _remove(provider: ModelProvider): Promise<void>
	{
		this.error.set(null);
		this._busyProvider.set(provider);
		try
		{
			await this._gateway.deleteKey(provider);
			this._clearDraft(provider);
			this._keys.reload();
		}
		catch (error)
		{
			this.error.set(this._messageOf(error));
		}
		finally
		{
			this._busyProvider.set(null);
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

	/** Narrow an unknown thrown value to a human-readable message. */
	private _messageOf(error: unknown): string
	{
		return error instanceof Error ? error.message : String(error);
	}
}
