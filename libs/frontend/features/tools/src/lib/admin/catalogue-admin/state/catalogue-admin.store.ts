import { Injectable, Signal, computed, inject, resource, signal } from "@angular/core";
import { McpApprovalStatus, McpServer } from "@opencrane/core";
import { MCP_GATEWAY } from "@opencrane/state/mcp/adapter";
import { SessionStore } from "@opencrane/state/core";

/** Owns catalogue administration reads and serialises commands that target the same server. */
@Injectable()
export class CatalogueAdminStore
{
	/** Active MCP data source (live OpenCrane when bound; mock in dev). */
	private readonly _gateway = inject(MCP_GATEWAY);

	/** App-wide session/identity (drives the admin capability gate). */
	private readonly _session = inject(SessionStore);

	/** Whether the session may use the admin console (else a denied state shows). */
	public readonly canAdminister: Signal<boolean> = computed((): boolean => this._session.capabilities().customerAdmin);

	/** Full catalogue incl. pending/disabled (admin scope). */
	private readonly _catalogue = resource({
		params: this.canAdminister,
		loader: this._Load.bind(this)
	});



	/** Server ids whose governance command is pending. */
	public readonly busy = signal<ReadonlySet<string>>(new Set());
	/** Last command failure. */
	public readonly error = signal<string | null>(null);
	/** Shows a pending read independently from an empty catalogue. */
	public readonly loading = this._catalogue.isLoading;
	/** Shows failures separately from an empty catalogue. */
	public readonly readError = computed(() => this._catalogue.error() ? "The catalogue could not be refreshed. Try again." : null);
	/** All catalogue servers. */
	public readonly servers: Signal<McpServer[]> = computed((): McpServer[] => (this._catalogue.hasValue() ? this._catalogue.value() : []));

	/** Count of servers awaiting review, for the heading subtitle. */
	public readonly pendingCount: Signal<number> = computed((): number =>
	{
		return this.servers().filter(function isPending(server: McpServer): boolean { return server.approvalStatus === McpApprovalStatus.PendingReview; }).length;
	});

	/** Approve a pending server, then refresh. */
	public async approve(server: McpServer): Promise<void>
	{
		if (!this.canAdminister() || this.busy().has(server.id))
			return;
		this.error.set(null);
		this.busy.update(current => new Set([...current, server.id]));
		try
		{
			await this._gateway.approve(server.id);
			this._catalogue.reload();
		}
		catch { this.error.set("The catalogue change could not be saved. Try again."); }
		finally
		{
			this.busy.update(function _Release(current) { const next = new Set(current); next.delete(server.id); return next; });
		}
	}

	/** Publish an approved server, then refresh. */
	public async publish(server: McpServer): Promise<void>
	{
		if (!this.canAdminister() || this.busy().has(server.id))
			return;
		this.error.set(null);
		this.busy.update(current => new Set([...current, server.id]));
		try
		{
			await this._gateway.publish(server.id);
			this._catalogue.reload();
		}
		catch { this.error.set("The catalogue change could not be saved. Try again."); }
		finally
		{
			this.busy.update(function _Release(current) { const next = new Set(current); next.delete(server.id); return next; });
		}
	}

	/** Reject a pending server, then refresh. */
	public async reject(server: McpServer): Promise<void>
	{
		if (!this.canAdminister() || this.busy().has(server.id))
			return;
		this.error.set(null);
		this.busy.update(current => new Set([...current, server.id]));
		try
		{
			await this._gateway.reject(server.id);
			this._catalogue.reload();
		}
		catch { this.error.set("The catalogue change could not be saved. Try again."); }
		finally
		{
			this.busy.update(function _Release(current) { const next = new Set(current); next.delete(server.id); return next; });
		}
	}

	/** Toggle a published/disabled server's enabled state, then refresh. */
	public async setEnabled(server: McpServer, enabled: boolean): Promise<void>
	{
		if (!this.canAdminister() || this.busy().has(server.id))
			return;
		this.error.set(null);
		this.busy.update(current => new Set([...current, server.id]));
		try
		{
			await this._gateway.setEnabled(server.id, enabled);
			this._catalogue.reload();
		}
		catch { this.error.set("The catalogue change could not be saved. Try again."); }
		finally
		{
			this.busy.update(function _Release(current) { const next = new Set(current); next.delete(server.id); return next; });
		}
	}

	/** Retries the read without repeating a governance command. */
	public refresh(): void { this._catalogue.reload(); }
	/** The server still checks grants for every read and mutation. */
	private _Load(): Promise<McpServer[]> { return this.canAdminister() ? this._gateway.listCatalogue() : Promise.resolve([]); }
}
