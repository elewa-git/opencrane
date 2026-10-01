import { DestroyRef, Injectable, computed, inject, resource, signal } from "@angular/core";
import { McpConnectionStatus, McpInstallStates, type McpConnectionProjection, type McpInstalledServer } from "@opencrane/core";
import { MCP_GATEWAY, McpConnectionCommandError, McpConnectionCommandFailureKinds } from "@opencrane/state/mcp/adapter";
import { _FilterCatalogue, _InstalledToolRows } from "./tools-inventory.mapper";
import { ToolCatalogueFilters, type ToolCatalogueFilter, type ToolConnectionCoordinate } from "./tools-inventory.types";

const _POLL_ATTEMPT_LIMIT = 6;
const _POLL_INITIAL_DELAY_MS = 1_000;
const _POLL_MAX_DELAY_MS = 8_000;

/** Owns entitled catalogue reads and per-server install commands for one tools route. */
@Injectable()
export class ToolsInventoryStore
{
	/** Transport supplied by the application. */
	private readonly _gateway = inject(MCP_GATEWAY);
	/** Cancels status polling and drops route-scoped command claims on destroy. */
	private readonly _destroyRef = inject(DestroyRef);
	/** Entitled descriptions supplied by the latest successful read. */
	private readonly _catalogue = resource({ loader: this._LoadCatalogue.bind(this) });
	/** Server-confirmed installations. */
	private readonly _installed = resource({ loader: this._LoadInstalled.bind(this) });
	/** Commands are admitted independently for each server. */
	public readonly busy = signal<ReadonlySet<string>>(new Set());
	/** Claims include ambiguous writes that are not currently waiting on transport. */
	private readonly _reserved = signal<ReadonlySet<string>>(new Set());
	/** Scheduled status refresh, cancelled when its pending coordinate changes. */
	private _pollTimer: ReturnType<typeof setTimeout> | null = null;
	/** Stable set of server status coordinates covered by the current polling allowance. */
	private _pollKey = "";
	/** Number of automatic refreshes issued for the current polling coordinates. */
	private _pollAttempt = 0;
	/** Prevents a late inventory response from scheduling work after route destruction. */
	private _destroyed = false;
	/** Last command failure presented beside the inventory. */
	public readonly error = signal<string | null>(null);
	/** Advances when an authenticated inventory read proves this route lost MCP access. */
	public readonly accessLossRevision = signal(0);
	/** Controlled catalogue search. */
	public readonly search = signal("");
	/** Controlled connection-type filter. */
	public readonly typeFilter = signal<ToolCatalogueFilter>(ToolCatalogueFilters.All);
	/** Entitled descriptions available to the current resource. */
	private readonly _servers = computed(() => this._catalogue.hasValue() ? this._catalogue.value() : []);
	/** Current installation records available to the resource. */
	private readonly _installs = computed(() => this._installed.hasValue() ? this._installed.value() : []);
	/** Server ids from a completed successful entitlement read, or null while its authority is unknown. */
	public readonly entitledServerIds = computed<ReadonlySet<string> | null>(() => !this._catalogue.hasValue() || this._catalogue.isLoading() || this._catalogue.error() ? null : new Set(this._catalogue.value().map(server => server.id)));
	/** Current server-owned installations for connection-state coordination. */
	public readonly installations = computed<readonly McpInstalledServer[]>(() => this._installs());
	/** Filtered catalogue cards. */
	public readonly servers = computed(() => _FilterCatalogue(this._servers(), this.search(), this.typeFilter()));
	/** Installed rows use only descriptions returned to this user. */
	public readonly rows = computed(() => _InstalledToolRows(this._servers(), this._installs()));
	/** Server ids already installed. */
	public readonly installedIds = computed(() => new Set(this._installs().map(record => record.serverId)));
	/** Entitled count before browser filtering. */
	public readonly total = computed(() => this._servers().length);
	/** Distinguishes reading from an empty inventory. */
	public readonly loading = computed(() => this._catalogue.isLoading() || this._installed.isLoading());
	/** Explains failed reads separately from an empty inventory. */
	public readonly readError = computed(() => this._catalogue.error() || this._installed.error() ? "Tools could not be refreshed. Try again." : null);

	constructor()
	{
		this._destroyRef.onDestroy(() =>
		{
			this._destroyed = true;
			this._ClearPoll();
			this.busy.set(new Set());
			this._reserved.set(new Set());
		});
	}

	/** Refreshes both projections without starting a mutation. */
	public refresh(): void { this._catalogue.reload(); this._installed.reload(); }

	/** Installs once per server, then reloads the authoritative installation projection. */
	public async install(serverId: string): Promise<void>
	{
		if (this.installedIds().has(serverId) || !this.reserveCommand(serverId))
			return;
		try
		{
			await this._gateway.install(serverId);
			this._installed.reload();
		}
		catch { this.error.set("The tool could not be installed. Try again."); }
		finally { this.finishCommand(serverId); }
	}

	/** Removes once per server and refreshes the server-owned installation list. */
	public async uninstall(serverId: string): Promise<void>
	{
		if (this._installs().some(record => record.serverId === serverId && record.lifecycleState === McpInstallStates.Removing) || !this.reserveCommand(serverId))
			return;
		try
		{
			await this._gateway.uninstall(serverId);
			this._installed.reload();
		}
		catch { this.error.set("The tool could not be removed. Try again."); }
		finally { this.finishCommand(serverId); }
	}

	/** Returns whether an authoritative installed value has loaded at least once. */
	public hasInstalledValue(): boolean { return this._installed.hasValue(); }

	/** Finds one current installed projection without exposing the writable resource. */
	public installed(serverId: string): McpInstalledServer | null { return this._installs().find(record => record.serverId === serverId) ?? null; }

	/** Captures the server coordinates that a late connection response must still match. */
	public coordinate(serverId: string): ToolConnectionCoordinate | null
	{
		const installed = this.installed(serverId);
		return installed ? { lifecycleState: installed.lifecycleState, connectionGeneration: installed.connectionGeneration } : null;
	}

	/** Merge a safe command response only while the installed row still has its starting coordinates. */
	public adoptConnection(serverId: string, projection: McpConnectionProjection, expected: ToolConnectionCoordinate): boolean
	{
		if (!this._installed.hasValue())
			return false;
		let adopted = false;
		this._installed.update(function _Adopt(current)
		{
			if (!current)
				return current;
			const next = current.map(function _Connection(record)
			{
				if (record.serverId !== serverId || record.lifecycleState !== expected.lifecycleState || record.connectionGeneration !== expected.connectionGeneration)
					return record;
				adopted = true;
				return { ...record, ...projection };
			});
			return next;
		});
		if (adopted)
			this._SchedulePoll(this._installs());
		return adopted;
	}

	/** Reload only the installed projection after a connection command or status tick. */
	public reloadInstalled(): void { this._installed.reload(); }

	/** Claim the shared server command scope before its first asynchronous step. */
	public reserveCommand(serverId: string): boolean
	{
		if (this._reserved().has(serverId))
			return false;
		this._reserved.update(current => new Set([...current, serverId]));
		this.busy.update(current => new Set([...current, serverId]));
		this.error.set(null);
		return true;
	}

	/** Resume the only retained ambiguous command without admitting a second command. */
	public resumeCommand(serverId: string): boolean
	{
		if (!this._reserved().has(serverId) || this.busy().has(serverId))
			return false;
		this.busy.update(current => new Set([...current, serverId]));
		return true;
	}

	/** Release transport activity and optionally retain the ambiguous command claim. */
	public finishCommand(serverId: string, retainReservation = false): void
	{
		this.busy.update(function _Release(current) { const next = new Set(current); next.delete(serverId); return next; });
		if (!retainReservation)
			this._reserved.update(function _Release(current) { const next = new Set(current); next.delete(serverId); return next; });
	}

	/** Whether this server already has an active or ambiguous command owner. */
	public commandReserved(serverId: string): boolean { return this._reserved().has(serverId); }

	/** Reads visible catalogue descriptions. */
	private async _LoadCatalogue(): Promise<Awaited<ReturnType<typeof this._gateway.listEntitledCatalogue>>>
	{
		try { return await this._gateway.listEntitledCatalogue(); }
		catch (error)
		{
			this._RecordAccessLoss(error);
			throw error;
		}
	}
	/** Reads installations for this user. */
	private async _LoadInstalled(): Promise<McpInstalledServer[]>
	{
		try
		{
			const installed = await this._gateway.listInstalled();
			this._SchedulePoll(installed);
			return installed;
		}
		catch (error)
		{
			this._RecordAccessLoss(error);
			throw error;
		}
	}

	/** Record only an authenticated permission change, never a transient read failure. */
	private _RecordAccessLoss(error: unknown): void
	{
		if (error instanceof McpConnectionCommandError && error.kind === McpConnectionCommandFailureKinds.AccessChanged)
			this.accessLossRevision.update(current => current + 1);
	}

	/** Schedule another authoritative read while activation or removal is still progressing. */
	private _SchedulePoll(installed: readonly McpInstalledServer[]): void
	{
		if (this._destroyed)
			return;
		const key = installed
			.filter(record => record.lifecycleState === McpInstallStates.Removing || record.connectionStatus === McpConnectionStatus.Activating)
			.map(record => `${record.serverId}:${record.lifecycleState}:${record.connectionGeneration ?? "none"}`)
			.sort()
			.join("|");
		if (key !== this._pollKey)
		{
			this._ClearPoll();
			this._pollKey = key;
			this._pollAttempt = 0;
		}
		if (key === "" || this._pollTimer !== null || this._pollAttempt >= _POLL_ATTEMPT_LIMIT)
			return;
		const delay = Math.min(_POLL_INITIAL_DELAY_MS * 2 ** this._pollAttempt, _POLL_MAX_DELAY_MS);
		this._pollTimer = setTimeout(() =>
		{
			this._pollTimer = null;
			this._pollAttempt += 1;
			this._installed.reload();
		}, delay);
	}

	/** Cancel the current automatic status refresh without changing server-owned values. */
	private _ClearPoll(): void
	{
		if (this._pollTimer !== null)
			clearTimeout(this._pollTimer);
		this._pollTimer = null;
	}
}
