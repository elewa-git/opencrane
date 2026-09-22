import { Injectable, inject } from "@angular/core";

import { GOVERNANCE_READ_GATEWAY } from "@opencrane/state/governance";

import { GovernanceSnapshotStore } from "../reporting/governance-snapshot.store";

/** Keeps recorded usage, global budgets and account overrides independently readable and retryable. */
@Injectable()
export class UsageStore
{
	/** App-bound reader repeats the server's current permission checks on each GET. */
	private readonly _gateway = inject(GOVERNANCE_READ_GATEWAY);
	/** Recorded rows have no reporting period or freshness timestamp in the current API. */
	public readonly usage = new GovernanceSnapshotStore(this._ReadUsage.bind(this), undefined);
	/** The API returns USD zero when no global row exists; this store does not reinterpret it. */
	public readonly globalBudget = new GovernanceSnapshotStore(this._ReadGlobalBudget.bind(this), undefined);
	/** Account overrides are loaded separately so one failure never hides a successful sibling read. */
	public readonly accountBudgets = new GovernanceSnapshotStore(this._ReadAccountBudgets.bind(this), undefined);

	/** Refreshes recorded usage without retrying either budget endpoint. */
	public refreshUsage(): void { this.usage.refresh(undefined); }
	/** Refreshes the returned global budget without affecting usage. */
	public refreshGlobalBudget(): void { this.globalBudget.refresh(undefined); }
	/** Refreshes account overrides without affecting the global result. */
	public refreshAccountBudgets(): void { this.accountBudgets.refresh(undefined); }

	/** Reads token snapshots, not a live provider invoice. */
	private _ReadUsage(_query: undefined, signal: AbortSignal) { return this._gateway.readTokenUsage(signal); }
	/** Reads the global budget under the endpoint's existing administration check. */
	private _ReadGlobalBudget(_query: undefined, signal: AbortSignal) { return this._gateway.readGlobalBudget(signal); }
	/** Reads account overrides under the endpoint's existing administration check. */
	private _ReadAccountBudgets(_query: undefined, signal: AbortSignal) { return this._gateway.readAccountBudgets(signal); }
}
