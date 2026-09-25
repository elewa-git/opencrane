import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from "@angular/core";

import { ToolApprovalScopeStates, type ToolApprovalScopeSummary } from "@opencrane/contracts";

import { TOOL_APPROVAL_SCOPE_GATEWAY } from "./opencrane-tool-approval-scope.gateway";
import { ToolApprovalScopeGatewayError, ToolApprovalScopeGatewayErrorKinds } from "./tool-approval-scope.errors";
import { TOOL_APPROVAL_SCOPE_SESSION, ToolApprovalScopeReadStates, type ToolApprovalScopeState } from "./tool-approval-scope.types";

/** Route-scoped current-requester list and revocation command owner. */
@Injectable()
export class ToolApprovalScopeStore
{
	/** Requester-owned generated API port. */
	private readonly _gateway = inject(TOOL_APPROVAL_SCOPE_GATEWAY);
	/** Verified account and tenant generation supplied by app composition. */
	private readonly _session = inject(TOOL_APPROVAL_SCOPE_SESSION);
	/** Stops reads and clears private summaries when the route is destroyed. */
	private readonly _destroyRef = inject(DestroyRef);
	/** Session key that owns every retained row and command coordinate. */
	private readonly _scope = signal<string | null>(null);
	/** Safe owner summaries from all pages loaded for the current session. */
	private readonly _scopes = signal<readonly ToolApprovalScopeSummary[]>([]);
	/** Opaque cursor supplied by the latest loaded page. */
	private readonly _nextCursor = signal<string | null>(null);
	/** Cursors used for loaded pages, retained so uncertain writes can re-read the same reach. */
	private readonly _loadedPageCursors = signal<readonly (string | undefined)[]>([]);
	/** Current first-page or continuation read state. */
	private readonly _readState = signal(ToolApprovalScopeReadStates.Inactive);
	/** Safe list-level failure text. */
	private readonly _error = signal<string | null>(null);
	/** Scope identifiers with one admitted revocation in flight. */
	private readonly _busyIds = signal<ReadonlySet<string>>(new Set());
	/** Per-row command feedback kept separate from list-read feedback. */
	private readonly _commandErrors = signal<Readonly<Record<string, string>>>({});
	/** Latest confirmed revoked row announced by the view. */
	private readonly _revokedId = signal<string | null>(null);
	/** Stable retry keys kept until an authoritative revoked response or refreshed row is adopted. */
	private readonly _retryKeys = new Map<string, string>();
	/** Invalidates every earlier read or command when identity or route lifetime changes. */
	private _generation = 0;
	/** Cancels the current list read. */
	private _abort: AbortController | null = null;
	/** Prevents destroyed route state from starting work. */
	private _destroyed = false;
	/** Requires verified identity revalidation after the server refuses requester access. */
	private _denied = false;

	/** Current-identity view of every loaded safe summary. */
	public readonly scopes = computed(this._Scopes.bind(this));
	/** Current-identity read lifecycle. */
	public readonly readState = computed(this._ReadState.bind(this));
	/** Current-identity list failure. */
	public readonly error = computed(this._Error.bind(this));
	/** Whether the server supplied an opaque continuation coordinate. */
	public readonly hasMore = computed(() => this._Current() && this._nextCursor() !== null);
	/** Per-scope command concurrency exposed as immutable membership. */
	public readonly busyIds = computed(() => this._Current() ? this._busyIds() : new Set<string>());
	/** Safe revocation failures keyed by the already visible opaque scope identifier. */
	public readonly commandErrors = computed(() => this._Current() ? this._commandErrors() : {});
	/** Latest scope whose authoritative revoked state was adopted. */
	public readonly revokedId = computed(() => this._Current() ? this._revokedId() : null);
	/** One presentation projection for the thin route coordinator. */
	public readonly state = computed<ToolApprovalScopeState>(() => ({ scopes: this.scopes(), readState: this.readState(), error: this.error(), hasMore: this.hasMore() }));

	/** Observe verified identity and bind all private state to this route's lifetime. */
	public constructor()
	{
		effect(this._ObserveSession.bind(this));
		this._destroyRef.onDestroy(this._Destroy.bind(this));
	}

	/** Replace loaded pages with the newest authoritative page. */
	public refresh(): Promise<void>
	{
		if (this._denied)
		{
			this._denied = false;
			this._session.revalidate();
		}
		return this._Read(undefined, false);
	}
	/** Append the next server-sized page using only the returned opaque cursor. */
	public loadMore(): Promise<void>
	{
		const cursor = this._nextCursor();
		return cursor === null ? Promise.resolve() : this._Read(cursor, true);
	}

	/** Withdraw one visible active scope; uncertain retries keep the same command key. */
	public async revoke(scopeId: string): Promise<void>
	{
		const target = this.scopes().find(scope => scope.id === scopeId);
		if (target?.state !== ToolApprovalScopeStates.Active || this.busyIds().has(scopeId))
			return;
		const generation = this._generation;
		const key = this._retryKeys.get(scopeId) ?? globalThis.crypto.randomUUID();
		this._retryKeys.set(scopeId, key);
		this._SetBusy(scopeId, true);
		this._SetCommandError(scopeId, null);
		this._revokedId.set(null);
		try
		{
			const result = await this._gateway.revoke(scopeId, key);
			if (!this._Matches(generation) || result.scope.id !== scopeId)
				return;
			this._AdoptRevoked(result.scope);
		}
		catch (error)
		{
			if (!this._Matches(generation))
				return;
			if (error instanceof ToolApprovalScopeGatewayError && error.kind === ToolApprovalScopeGatewayErrorKinds.Forbidden)
			{
				this._SetBusy(scopeId, false);
				this._SetCommandError(scopeId, "You no longer have permission to revoke this standing approval.");
				await this._Read(undefined, false);
				return;
			}
			await this._ReconcileUncertain(scopeId, generation);
		}
		finally
		{
			if (this._Matches(generation))
				this._SetBusy(scopeId, false);
		}
	}

	/** Read only the verified session signal inside the identity effect. */
	private _ObserveSession(): void
	{
		const scope = this._session.scope();
		untracked(this._SetSession.bind(this, scope));
	}

	/** Purge before starting the first read for a different account, tenant, or login generation. */
	private _SetSession(scope: string | null): void
	{
		if (scope === this._scope())
			return;
		this._Purge();
		this._scope.set(scope);
		this._denied = false;
		this._readState.set(scope === null ? ToolApprovalScopeReadStates.Inactive : ToolApprovalScopeReadStates.Loading);
		if (scope !== null)
			void this.refresh();
	}

	/** Read one page while keeping all cursor semantics inside the server contract. */
	private async _Read(cursor: string | undefined, append: boolean): Promise<void>
	{
		if (this._destroyed || this._denied || this._scope() === null || !this._Current() || this._busyIds().size > 0 || (append && this._readState() === ToolApprovalScopeReadStates.LoadingMore))
			return;
		this._abort?.abort();
		const abort = new AbortController();
		this._abort = abort;
		const generation = ++this._generation;
		this._readState.set(append ? ToolApprovalScopeReadStates.LoadingMore : ToolApprovalScopeReadStates.Loading);
		this._error.set(null);
		try
		{
			const page = await this._gateway.list(cursor, abort.signal);
			if (!this._Matches(generation))
				return;
			const rows = append ? _Merge(this._scopes(), page.scopes) : page.scopes;
			this._scopes.set(rows);
			this._loadedPageCursors.set(append ? [...this._loadedPageCursors(), cursor] : [undefined]);
			this._nextCursor.set(page.nextCursor ?? null);
			this._readState.set(ToolApprovalScopeReadStates.Ready);
		}
		catch (error)
		{
			if (!this._Matches(generation) || abort.signal.aborted)
				return;
			if (error instanceof ToolApprovalScopeGatewayError && error.kind === ToolApprovalScopeGatewayErrorKinds.Forbidden)
			{
				this._Purge();
				this._denied = true;
				this._error.set("Your access changed. Refresh to check your sign-in.");
				this._readState.set(ToolApprovalScopeReadStates.Unavailable);
				this._session.revalidate();
				return;
			}
			if (!append)
				this._scopes.set([]);
			this._error.set("Standing approvals could not be loaded. Try again.");
			this._readState.set(ToolApprovalScopeReadStates.Unavailable);
		}
	}

	/** Re-read every page already reached and adopt a revoked row if the command completed remotely. */
	private async _ReconcileUncertain(scopeId: string, generation: number): Promise<void>
	{
		try
		{
			let rows: readonly ToolApprovalScopeSummary[] = [];
			for (const cursor of this._loadedPageCursors())
			{
				const page = await this._gateway.list(cursor);
				if (!this._Matches(generation))
					return;
				rows = _Merge(rows, page.scopes);
			}
			this._scopes.set(rows);
			const reconciled = rows.find(scope => scope.id === scopeId);
			if (reconciled?.state === ToolApprovalScopeStates.Revoked)
			{
				this._AdoptRevoked(reconciled);
				return;
			}
		}
		catch (error)
		{
			if (!this._Matches(generation))
				return;
			if (error instanceof ToolApprovalScopeGatewayError && error.kind === ToolApprovalScopeGatewayErrorKinds.Forbidden)
			{
				this._Purge();
				this._denied = true;
				this._error.set("Your access changed. Refresh to check your sign-in.");
				this._readState.set(ToolApprovalScopeReadStates.Unavailable);
				this._session.revalidate();
				return;
			}
			// The same saved key remains available for an explicit retry below.
		}
		if (this._Matches(generation))
			this._SetCommandError(scopeId, "OpenCrane could not confirm whether this approval was revoked. Try again to safely repeat the same request.");
	}

	/** Adopt only the returned authoritative row and finish the saved retry coordinate. */
	private _AdoptRevoked(scope: ToolApprovalScopeSummary): void
	{
		this._scopes.update(scopes => scopes.map(current => current.id === scope.id ? scope : current));
		this._retryKeys.delete(scope.id);
		this._SetCommandError(scope.id, null);
		this._revokedId.set(scope.id);
	}

	/** Add or remove one scope from the immutable busy set. */
	private _SetBusy(scopeId: string, busy: boolean): void
	{
		this._busyIds.update(current =>
		{
			const next = new Set(current);
			if (busy)
				next.add(scopeId);
			else
				next.delete(scopeId);
			return next;
		});
	}

	/** Replace one row's command message without retaining arbitrary server errors. */
	private _SetCommandError(scopeId: string, message: string | null): void
	{
		this._commandErrors.update(current =>
		{
			const next = { ...current };
			if (message === null)
				delete next[scopeId];
			else
				next[scopeId] = message;
			return next;
		});
	}

	/** Expose rows only while their verified session still matches synchronously. */
	private _Scopes(): readonly ToolApprovalScopeSummary[] { return this._Current() ? this._scopes() : []; }
	/** Expose read state only for the current verified identity. */
	private _ReadState(): ToolApprovalScopeReadStates { return this._Current() ? this._readState() : ToolApprovalScopeReadStates.Inactive; }
	/** Expose list failure only for the current verified identity. */
	private _Error(): string | null { return this._Current() ? this._error() : null; }
	/** Check current identity synchronously before every adoption. */
	private _Current(): boolean { return this._scope() !== null && this._scope() === this._session.scope(); }
	/** Check both identity and operation generation after an asynchronous step. */
	private _Matches(generation: number): boolean { return !this._destroyed && generation === this._generation && this._Current(); }

	/** Remove all current-user summaries, cursors and retry coordinates. */
	private _Purge(): void
	{
		this._generation += 1;
		this._abort?.abort();
		this._abort = null;
		this._scopes.set([]);
		this._nextCursor.set(null);
		this._loadedPageCursors.set([]);
		this._busyIds.set(new Set());
		this._commandErrors.set({});
		this._revokedId.set(null);
		this._retryKeys.clear();
		this._error.set(null);
	}

	/** End route-owned work and make every completion stale. */
	private _Destroy(): void { this._destroyed = true; this._Purge(); this._scope.set(null); this._readState.set(ToolApprovalScopeReadStates.Inactive); }
}

/** Merge server pages without allowing a repeated identifier to create a second row. */
function _Merge(current: readonly ToolApprovalScopeSummary[], next: readonly ToolApprovalScopeSummary[]): readonly ToolApprovalScopeSummary[]
{
	const byId = new Map(current.map(scope => [scope.id, scope]));
	for (const scope of next)
		byId.set(scope.id, scope);
	return [...byId.values()];
}
