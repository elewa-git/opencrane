import { Injectable, inject, signal } from "@angular/core";

import { OrganizationMembersGatewayError } from "./organization-members.errors";
import { ORGANIZATION_MEMBERS_GATEWAY } from "./organization-members.gateway";
import { OrganizationInviteAcceptanceStates } from "./organization-invite-acceptance.types";
import type { OrganizationMember } from "./organization-member-directory.types";
import { OrganizationMembersGatewayErrorKinds } from "./organization-members-gateway.types";

/**
 * Owns one invitation-token acceptance command for the guarded `/invite` route.
 *
 * The token stays in memory only while an unresolved command may be retried. It is never logged,
 * persisted, projected into presentation state, or combined with caller identity; the server derives
 * the accepting identity from the verified session. Keeping acceptance separate prevents its bearer
 * token from entering the directory, create, or resend stores.
 */
@Injectable()
export class OrganizationInviteAcceptanceStore
{
	/** Ordinary user-session port to organization membership authority. */
	private readonly _gateway = inject(ORGANIZATION_MEMBERS_GATEWAY);
	/** Current acceptance lifecycle. */
	private readonly _state = signal(OrganizationInviteAcceptanceStates.Idle);
	/** Resulting member after authority confirms acceptance. */
	private readonly _member = signal<OrganizationMember | null>(null);
	/** Browser-safe failure message shown without server response prose. */
	private readonly _error = signal<string | null>(null);
	/** Token retained only across an ambiguous failure for an explicit retry. */
	private _retryToken: string | null = null;

	/** Public acceptance lifecycle. */
	public readonly state = this._state.asReadonly();
	/** Public accepted member projection. */
	public readonly member = this._member.asReadonly();
	/** Public browser-safe acceptance failure. */
	public readonly error = this._error.asReadonly();

	/**
	 * Consume one token after the route has removed it from the address bar.
	 *
	 * Duplicate admission is ignored while the first command runs. Terminal results clear the token;
	 * only an ambiguous failure retains it for {@link retry}.
	 *
	 * @param token - Opaque server-signed value copied once from the route query.
	 * @returns Resolves when authority returns or the failure is translated.
	 */
	public async accept(token: string): Promise<void>
	{
		if (this._state() === OrganizationInviteAcceptanceStates.Accepting) return;
		if (token.trim().length === 0)
		{
			this._state.set(OrganizationInviteAcceptanceStates.Invalid);
			this._error.set("This invitation link is missing its token.");
			return;
		}
		this._retryToken = token;
		this._state.set(OrganizationInviteAcceptanceStates.Accepting);
		this._error.set(null);
		try
		{
			const result = await this._gateway.accept(token);
			this._member.set(result.member);
			this._state.set(OrganizationInviteAcceptanceStates.Success);
			this._retryToken = null;
		}
		catch (error)
		{
			this._AdoptFailure(error);
		}
	}

	/** Retries the same unresolved token without reading it from browser storage or history. */
	public async retry(): Promise<void>
	{
		const token = this._retryToken;
		if (token === null) return;
		await this.accept(token);
	}

	/** Translates safe gateway categories and clears tokens for terminal rejections. */
	private _AdoptFailure(error: unknown): void
	{
		if (error instanceof OrganizationMembersGatewayError)
		{
			if (error.kind === OrganizationMembersGatewayErrorKinds.IdentityMismatch) this._state.set(OrganizationInviteAcceptanceStates.IdentityMismatch);
			else if (error.kind === OrganizationMembersGatewayErrorKinds.Expired) this._state.set(OrganizationInviteAcceptanceStates.Expired);
			else if (error.kind === OrganizationMembersGatewayErrorKinds.AlreadyUsed) this._state.set(OrganizationInviteAcceptanceStates.AlreadyUsed);
			else if (error.kind === OrganizationMembersGatewayErrorKinds.Invalid) this._state.set(OrganizationInviteAcceptanceStates.Invalid);
			else
			{
				this._state.set(OrganizationInviteAcceptanceStates.Failure);
				this._error.set("OpenCrane could not confirm this invitation. Retry to check whether it was accepted.");
				return;
			}
			this._retryToken = null;
			return;
		}
		this._state.set(OrganizationInviteAcceptanceStates.Failure);
		this._error.set("OpenCrane could not confirm this invitation. Retry to check whether it was accepted.");
	}
}
