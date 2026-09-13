import { Injectable, computed, inject, resource, signal } from "@angular/core";

import { OrganizationMembersGatewayError } from "./organization-members.errors";
import { ORGANIZATION_MEMBERS_GATEWAY } from "./organization-members.gateway";
import { OrganizationMemberDirectoryStates, OrganizationMemberStatuses, type OrganizationMember, type OrganizationMemberDirectory } from "./organization-member-directory.types";
import { OrganizationMembersGatewayErrorKinds } from "./organization-members-gateway.types";

/** Owns one route's directory, authoritative removal adoption and access-loss fence. */
@Injectable()
export class OrganizationMemberDirectoryStore
{
	private readonly _gateway = inject(ORGANIZATION_MEMBERS_GATEWAY);
	private readonly _retained = signal<OrganizationMemberDirectory | null>(null);
	private readonly _refreshError = signal<string | null>(null);
	private readonly _forbidden = signal(false);
	private readonly _accessGeneration = signal(0);
	private readonly _request = signal(0);
	private _readGeneration = 0;

	/** Owns initial and explicit reads; its raw value is never a second directory cache. */
	public readonly resource = resource({ params: this._request, loader: this._Load.bind(this), defaultValue: null });
	/** Exposes only a generation-checked authoritative projection. */
	public readonly directory = this._retained.asReadonly();
	/** Distinguishes denied access from a temporary refresh outage. */
	public readonly state = computed(this._State.bind(this));
	public readonly refreshError = this._refreshError.asReadonly();
	/** Invalidates every command begun before proven access loss, even after a later reload. */
	public readonly accessGeneration = this._accessGeneration.asReadonly();

	/** Explicitly rechecks access; a denied projection stays empty until this read succeeds. */
	public refresh(): void
	{
		this._readGeneration++;
		this._request.update(value => value + 1);
	}

	/** Purges rows and aborts their publication after a directory or command denial. */
	public forbid(): void
	{
		this._readGeneration++;
		this._accessGeneration.update(value => value + 1);
		this._forbidden.set(true);
		this._retained.set(null);
		this._refreshError.set(null);
		this.resource.set(null);
	}

	/** Adopts the exact successful command result and invalidates any older in-flight read. */
	public adopt(member: OrganizationMember, accessGeneration: number): boolean
	{
		const directory = this._retained();
		if (this._forbidden() || accessGeneration !== this._accessGeneration() || directory === null)
			return false;
		const previous = directory.members.find(row => row.membershipId === member.membershipId);
		if (previous === undefined)
			return false;
		this._readGeneration++;
		const activeChange = Number(member.status === OrganizationMemberStatuses.Active) - Number(previous.status === OrganizationMemberStatuses.Active);
		const next = { ...directory, members: directory.members.map(row => row.membershipId === member.membershipId ? member : row), activeCount: Math.max(0, directory.activeCount + activeChange) };
		this._retained.set(next);
		this._refreshError.set(null);
		this.resource.set(next);
		return true;
	}

	/** Publishes only the latest authorized read; a denial always discards retained private data. */
	private async _Load(): Promise<OrganizationMemberDirectory | null>
	{
		const generation = ++this._readGeneration;
		const access = this._accessGeneration();
		try
		{
			const value = await this._gateway.load();
			if (generation !== this._readGeneration || access !== this._accessGeneration())
				return null;
			this._retained.set(value);
			this._forbidden.set(false);
			this._refreshError.set(null);
			return value;
		}
		catch (error)
		{
			if (generation !== this._readGeneration || access !== this._accessGeneration())
				return null;
			if (error instanceof OrganizationMembersGatewayError && error.kind === OrganizationMembersGatewayErrorKinds.Forbidden)
			{
				this.forbid();
				return null;
			}
			if (this._retained() === null)
				throw error;
			this._refreshError.set("Members could not be refreshed. The directory below may be out of date.");
			return this._retained();
		}
	}

	/** Translates resource activity while giving a proven denial precedence over stale values. */
	private _State(): OrganizationMemberDirectoryStates
	{
		if (this._forbidden())
			return OrganizationMemberDirectoryStates.Forbidden;
		const directory = this.directory();
		if (this.resource.isLoading())
			return directory === null ? OrganizationMemberDirectoryStates.Loading : OrganizationMemberDirectoryStates.Refreshing;
		if (this._refreshError() !== null && directory !== null)
			return OrganizationMemberDirectoryStates.RetainedRefreshError;
		if (directory === null)
			return OrganizationMemberDirectoryStates.Unavailable;
		return directory.members.length === 0 && directory.invitations.length === 0 ? OrganizationMemberDirectoryStates.Empty : OrganizationMemberDirectoryStates.Ready;
	}
}
