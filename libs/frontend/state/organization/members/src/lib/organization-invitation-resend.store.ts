import { Injectable, inject, signal } from "@angular/core";

import { _MergeReturnedInvitations, _NewInvitationIdempotencyKey } from "./invitation-command.utils";
import { ORGANIZATION_MEMBERS_GATEWAY } from "./organization-members.gateway";
import { _OrganizationMembersCommandMessage } from "./organization-members-error-mapper";
import type { OrganizationInvitation } from "./organization-invitations.types";

/**
 * Owns independent per-invitation resend commands and their retry identities.
 * Keeping resend separate lets different rows proceed concurrently while each failed row retains its
 * own key until authority returns a refreshed invitation generation.
 */
@Injectable()
export class OrganizationInvitationResendStore
{
	/** Ordinary user-session membership port. */
	private readonly _gateway = inject(ORGANIZATION_MEMBERS_GATEWAY);
	/** Invitation ids currently admitted for resend. */
	private readonly _busyIds = signal<ReadonlySet<string>>(new Set());
	/** Retry keys retained until refreshed rows arrive. */
	private readonly _keys = new Map<string, string>();
	/** Authoritative rows returned by resend authority. */
	private readonly _invitations = signal<readonly OrganizationInvitation[]>([]);
	/** Latest server-authored shareable link. */
	private readonly _link = signal<string | null>(null);
	/** Browser-safe latest resend failure. */
	private readonly _error = signal<string | null>(null);

	/** Public per-target admission set. */
	public readonly busyIds = this._busyIds.asReadonly();
	/** Public authoritative resend rows. */
	public readonly invitations = this._invitations.asReadonly();
	/** Public latest server-authored link. */
	public readonly link = this._link.asReadonly();
	/** Public latest resend failure. */
	public readonly error = this._error.asReadonly();

	/** Resends one invitation while allowing independent rows to proceed. */
	public async resend(invitationId: string): Promise<boolean>
	{
		if (invitationId.length === 0 || this._busyIds().has(invitationId)) return false;
		this._SetBusy(invitationId, true);
		this._link.set(null);
		this._error.set(null);
		const key = this._keys.get(invitationId) ?? _NewInvitationIdempotencyKey();
		this._keys.set(invitationId, key);
		try
		{
			const result = await this._gateway.resend(invitationId, key);
			this._invitations.update(current => _MergeReturnedInvitations([result.invitation], current));
			this._link.set(result.inviteLink);
			this._keys.delete(invitationId);
			return true;
		}
		catch (error)
		{
			this._error.set(_OrganizationMembersCommandMessage(error, "OpenCrane could not refresh this invitation link."));
			return false;
		}
		finally { this._SetBusy(invitationId, false); }
	}

	/** Adds or removes one target without clearing another target's busy state. */
	private _SetBusy(invitationId: string, active: boolean): void
	{
		const next = new Set(this._busyIds());
		if (active) next.add(invitationId);
		else next.delete(invitationId);
		this._busyIds.set(next);
	}
}
