import { Injectable, inject } from "@angular/core";

import { ___ParseApiErrorEnvelope } from "@opencrane/contracts";
import { ControlPlaneApiService } from "@opencrane/core";
import { OrganizationMembersGatewayError, OrganizationMembersGatewayErrorKinds, type AcceptOrganizationInvitationResult, type CreateOrganizationInvitationsCommand, type CreateOrganizationInvitationsResult, type OrganizationInviteValidationResult, type OrganizationMembersGateway, type OrganizationMemberDirectory, type ResendOrganizationInvitationResult } from "@opencrane/state/organization/members";

import { _MapOrganizationInviteAcceptance, _MapOrganizationInviteCreate, _MapOrganizationInviteResend, _MapOrganizationInviteValidation, _MapOrganizationMemberDirectory } from "./organization-members-wire.mapper";

/**
 * Adapts the generated organization-members endpoints to the browser port used by Settings.
 * The app composition root binds this adapter so stores receive allowlisted failure categories
 * without choosing the server-side membership authority.
 */
@Injectable()
export class OpenCraneOrganizationMembersGateway implements OrganizationMembersGateway
{
	/** Generated API client carrying the ordinary user's session cookie. */
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async load(): Promise<OrganizationMemberDirectory>
	{
		const result = await this._api.client.GET("/organization/members");
		if (!result.data) throw _GatewayError(result.error, result.response.status);
		return _MapOrganizationMemberDirectory(result.data);
	}

	/** @inheritdoc */
	public async validate(emails: readonly string[]): Promise<OrganizationInviteValidationResult>
	{
		const result = await this._api.client.POST("/organization/members/invitations/validate", { body: { emails: [...emails] } });
		if (!result.data) throw _GatewayError(result.error, result.response.status);
		return _MapOrganizationInviteValidation(result.data);
	}

	/** @inheritdoc */
	public async invite(command: CreateOrganizationInvitationsCommand): Promise<CreateOrganizationInvitationsResult>
	{
		const result = await this._api.client.POST("/organization/members/invitations", { params: { header: { "Idempotency-Key": command.idempotencyKey } }, body: { emails: [...command.emails], role: command.role } });
		if (!result.data) throw _GatewayError(result.error, result.response.status);
		return _MapOrganizationInviteCreate(result.data);
	}

	/** @inheritdoc */
	public async resend(invitationId: string, idempotencyKey: string): Promise<ResendOrganizationInvitationResult>
	{
		const result = await this._api.client.POST("/organization/members/invitations/{invitationId}/resend", { params: { header: { "Idempotency-Key": idempotencyKey }, path: { invitationId } } });
		if (!result.data) throw _GatewayError(result.error, result.response.status);
		return _MapOrganizationInviteResend(result.data);
	}

	/** @inheritdoc */
	public async accept(token: string): Promise<AcceptOrganizationInvitationResult>
	{
		const result = await this._api.client.POST("/organization/members/invitations/accept", { body: { token } });
		if (!result.data) throw _GatewayError(result.error, result.response.status);
		return _MapOrganizationInviteAcceptance(result.data);
	}
}

/** Reduce a public API error to categories the browser may branch on. */
function _GatewayError(value: unknown, status: number): OrganizationMembersGatewayError
{
	const error = ___ParseApiErrorEnvelope(value);
	const code = error?.code ?? "";
	const codeKinds: Readonly<Record<string, OrganizationMembersGatewayErrorKinds>> = {
		payment_required: OrganizationMembersGatewayErrorKinds.PaymentRequired,
		identity_mismatch: OrganizationMembersGatewayErrorKinds.IdentityMismatch,
		expired: OrganizationMembersGatewayErrorKinds.Expired,
		already_used: OrganizationMembersGatewayErrorKinds.AlreadyUsed,
		invalid: OrganizationMembersGatewayErrorKinds.Invalid,
		conflict: OrganizationMembersGatewayErrorKinds.Conflict
	};
	const kind = codeKinds[code] ?? _StatusKind(status);
	return new OrganizationMembersGatewayError(kind, error?.error ?? "Organization membership authority could not complete this request.");
}

/** Map transport status only after a stable public code had no more precise category. */
function _StatusKind(status: number): OrganizationMembersGatewayErrorKinds
{
	if (status === 402) return OrganizationMembersGatewayErrorKinds.PaymentRequired;
	if (status === 403) return OrganizationMembersGatewayErrorKinds.Forbidden;
	if (status === 409) return OrganizationMembersGatewayErrorKinds.Conflict;
	if (status === 410) return OrganizationMembersGatewayErrorKinds.Expired;
	if (status === 503) return OrganizationMembersGatewayErrorKinds.Unavailable;
	return OrganizationMembersGatewayErrorKinds.Unknown;
}
