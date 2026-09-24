import { Injectable, effect, inject, signal } from "@angular/core";

import { OrganizationMemberDirectoryStore } from "./organization-member-directory.store";
import { OrganizationMemberDirectoryStates, OrganizationMemberRemovalStates, OrganizationMemberStatuses } from "./organization-member-directory.types";
import { OrganizationMembersGatewayError } from "./organization-members.errors";
import { ORGANIZATION_MEMBERS_GATEWAY } from "./organization-members.gateway";
import { OrganizationMembersGatewayErrorKinds } from "./organization-members-gateway.types";

/** Owns per-member removal commands; current server eligibility and exact target identity remain mandatory. */
@Injectable()
export class OrganizationMemberRemovalStore
{
	private readonly _gateway = inject(ORGANIZATION_MEMBERS_GATEWAY);
	private readonly _directory = inject(OrganizationMemberDirectoryStore);
	private readonly _busyIds = signal<ReadonlySet<string>>(new Set());
	private readonly _message = signal<string | null>(null);
	private readonly _error = signal<string | null>(null);
	private _generation = this._directory.accessGeneration();
	public readonly busyIds = this._busyIds.asReadonly();
	public readonly message = this._message.asReadonly();
	public readonly error = this._error.asReadonly();

	/** Clears command state when the shared directory loses authority. */
	public constructor()
	{
		effect(() => { this._SyncAccess(); });
	}

	/** Removes only a currently offered exact row; repeated clicks cannot admit a second request. */
	public async remove(membershipId: string): Promise<void>
	{
		this._SyncAccess();
		const row = this._directory.directory()?.members.find(member => member.membershipId === membershipId);
		if (this._directory.state() === OrganizationMemberDirectoryStates.Forbidden || row?.removal.state !== OrganizationMemberRemovalStates.Available || this._busyIds().has(membershipId))
			return;
		const generation = this._generation;
		this._SetBusy(membershipId, true);
		this._message.set(null);
		this._error.set(null);
		try
		{
			const member = await this._gateway.remove(membershipId);
			if (generation !== this._directory.accessGeneration())
				return;
			if (member.membershipId !== membershipId || member.status !== OrganizationMemberStatuses.Suspended)
				throw new Error("Removal response did not match its target");
			if (this._directory.adopt(member, generation))
				this._message.set("Organization access removed. Existing conversation records are retained.");
		}
		catch (error)
		{
			if (generation !== this._directory.accessGeneration())
				return;
			if (error instanceof OrganizationMembersGatewayError && error.kind === OrganizationMembersGatewayErrorKinds.Forbidden)
				this._directory.forbid();
			else
			{
				const kind = error instanceof OrganizationMembersGatewayError ? error.kind : OrganizationMembersGatewayErrorKinds.Unknown;
				this._error.set(kind === OrganizationMembersGatewayErrorKinds.NotFound ? "This membership is no longer available. Refresh the directory." : "Removal could not be confirmed. Refresh to check access, or retry this member.");
				this._directory.refresh();
			}
		}
		finally
		{
			if (generation === this._directory.accessGeneration())
				this._SetBusy(membershipId, false);
			else
				this._SyncAccess();
		}
	}

	/** Invalidates pending callbacks and all private command feedback after access loss. */
	private _SyncAccess(): void
	{
		const generation = this._directory.accessGeneration();
		if (generation === this._generation)
			return;
		this._generation = generation;
		this._busyIds.set(new Set());
		this._message.set(null);
		this._error.set(null);
	}

	/** Changes only this target's lock while independent member commands proceed. */
	private _SetBusy(id: string, busy: boolean): void
	{
		const next = new Set(this._busyIds());
		if (busy)
			next.add(id);
		else
			next.delete(id);
		this._busyIds.set(next);
	}
}
