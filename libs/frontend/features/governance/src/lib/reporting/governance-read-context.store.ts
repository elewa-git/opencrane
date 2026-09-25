import { Injectable, inject, linkedSignal } from "@angular/core";

import { GOVERNANCE_READER_IDENTITY } from "@opencrane/state/governance";

import type { GovernanceReadScope } from "./governance-read-context.types";

/** Shares authentication loss across the independent reads on one reporting route. */
@Injectable()
export class GovernanceReadContextStore
{
	/** App-owned identity selection; this is not a grant or a role check. */
	private readonly _identity = inject(GOVERNANCE_READER_IDENTITY);
	/** A new object discards all old projections, including when the same user returns later. */
	public readonly scope = linkedSignal({ source: this._identity, computation: function _Scope(identity): GovernanceReadScope { return { identity }; } });

	/** A 401 invalidates sibling reads, but an old request cannot invalidate a new session. */
	public loseAuthentication(scope: GovernanceReadScope): void
	{
		if (this.scope() === scope)
			this.scope.set({ identity: null });
	}

	/** An explicit retry can recheck the cookie session without granting access to any data. */
	public recheck(): void
	{
		if (this.scope().identity === null)
			this.scope.set({ identity: this._identity() });
	}
}
