import { Injectable, computed, inject, resource, signal } from "@angular/core";

import { OrganizationMembersGatewayError } from "./organization-members.errors";
import { ORGANIZATION_MEMBERS_GATEWAY } from "./organization-members.gateway";
import { OrganizationMemberDirectoryStates, type OrganizationMemberDirectory } from "./organization-member-directory.types";
import { OrganizationMembersGatewayErrorKinds } from "./organization-members-gateway.types";

/**
 * Owns the member-directory read resource and its retained-refresh semantics for one route.
 * Keeping reads separate from invitation commands lets a failed refresh retain visible rows and a
 * warning without changing the create, resend, or acceptance lifecycle.
 */
@Injectable()
export class OrganizationMemberDirectoryStore
{
	/** Ordinary user-session membership port. */
	private readonly _gateway = inject(ORGANIZATION_MEMBERS_GATEWAY);
	/** Last successful projection retained across a failed refresh. */
	private readonly _retained = signal<OrganizationMemberDirectory | null>(null);
	/** Browser-safe warning attached to retained rows after a refresh failure. */
	private readonly _refreshError = signal<string | null>(null);
	/** Resource that performs the initial read and explicit refreshes. */
	public readonly resource = resource({ loader: this._Load.bind(this) });
	/** Freshest available directory, or the visibly retained previous projection. */
	public readonly directory = computed(this._Directory.bind(this));
	/** Explicit route state derived from the read resource. */
	public readonly state = computed(this._State.bind(this));
	/** Warning shown while retained data may be stale. */
	public readonly refreshError = this._refreshError.asReadonly();

	/** Retries the initial read or refreshes the visible projection. */
	public refresh(): void { this.resource.reload(); }

	/** Reads authority and retains a previous projection when a later refresh fails. */
	private async _Load(): Promise<OrganizationMemberDirectory>
	{
		try
		{
			const value = await this._gateway.load();
			this._retained.set(value);
			this._refreshError.set(null);
			return value;
		}
		catch (error)
		{
			const retained = this._retained();
			if (retained === null) throw error;
			this._refreshError.set("Members could not be refreshed. The directory below may be out of date.");
			return retained;
		}
	}

	/** Prefers the current resource value and falls back only after an unresolved first read. */
	private _Directory(): OrganizationMemberDirectory | null
	{
		return this.resource.hasValue() ? this.resource.value() : this._retained();
	}

	/** Translates the resource condition without exposing transport details. */
	private _State(): OrganizationMemberDirectoryStates
	{
		const directory = this._Directory();
		if (this.resource.isLoading()) return directory === null ? OrganizationMemberDirectoryStates.Loading : OrganizationMemberDirectoryStates.Refreshing;
		if (this._refreshError() !== null && directory !== null) return OrganizationMemberDirectoryStates.RetainedRefreshError;
		const error = this.resource.error();
		if (error instanceof OrganizationMembersGatewayError && error.kind === OrganizationMembersGatewayErrorKinds.Forbidden) return OrganizationMemberDirectoryStates.Forbidden;
		if (directory === null) return OrganizationMemberDirectoryStates.Unavailable;
		if (directory.members.length === 0 && directory.invitations.length === 0) return OrganizationMemberDirectoryStates.Empty;
		return OrganizationMemberDirectoryStates.Ready;
	}
}
