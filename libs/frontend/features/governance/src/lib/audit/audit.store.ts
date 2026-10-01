import { Injectable, computed, inject, linkedSignal } from "@angular/core";

import { GOVERNANCE_READ_GATEWAY, type GovernanceAuditPage, type GovernanceAuditQuery } from "@opencrane/state/governance";

import { GovernanceSnapshotStore } from "../reporting/governance-snapshot.store";
import { GovernanceReadContextStore } from "../reporting/governance-read-context.store";

/** Owns audit browsing; a server cursor advances even across a page with no readable rows. */
@Injectable()
export class AuditStore
{
	/** Protected audit reads are supplied by app composition. */
	private readonly _gateway = inject(GOVERNANCE_READ_GATEWAY);
	/** A different reader must start at the beginning rather than inherit another reader's cursor. */
	private readonly _context = inject(GovernanceReadContextStore);
	/** Distinguishes appending older records from restarting the current history view. */
	private readonly _appending = linkedSignal({ source: this._context.scope, computation: function _FirstPage() { return false; } });
	/** Owns read lifecycle and session fences while this store owns cursor meaning. */
	public readonly snapshot = new GovernanceSnapshotStore(this._ReadPage.bind(this), {} as GovernanceAuditQuery);
	/** Indicates that the current request is for the next examined server page. */
	public readonly loadingMore = computed(() => this._appending() && this.snapshot.busy());
	/** Preserves the failed page's retry position without claiming its rows were received. */
	public readonly loadMoreError = computed(() => this._appending() ? this.snapshot.feedback().error : null);

	/** Starts a new traversal; a failed refresh may retain the previous history with a warning. */
	public refresh(): void
	{
		if (this.snapshot.refresh({}))
			this._appending.set(false);
	}

	/** Rechecks permissions for the next cursor; a hidden page is not the end of the history. */
	public loadMore(): void
	{
		const pagination = this.snapshot.value()?.pagination;
		if (!pagination?.hasMore || !pagination.nextCursor)
			return;
		if (this.snapshot.refresh({ cursor: pagination.nextCursor }))
			this._appending.set(true);
	}

	/** Only a successful server page contributes rows; refresh replaces earlier page results. */
	private async _ReadPage(query: GovernanceAuditQuery, signal: AbortSignal, previous: GovernanceAuditPage | null): Promise<GovernanceAuditPage>
	{
		const page = await this._gateway.readAuditPage(query, signal);
		if (query?.cursor && previous !== null)
			return { ...page, data: [...previous.data, ...page.data] };
		return page;
	}
}
