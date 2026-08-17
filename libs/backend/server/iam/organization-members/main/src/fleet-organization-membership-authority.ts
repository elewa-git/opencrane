import type { OrganizationMembershipAuthority, OrganizationMembershipCaller } from "./authority.types";
import type { OrganizationMemberDirectory } from "./directory.types";
import type { FleetOrganizationMembershipTransport } from "./fleet-organization-membership-transport.types";
import type { AcceptOrganizationInvitationCommand, AcceptOrganizationInvitationResult, CreateOrganizationInvitationsCommand, CreateOrganizationInvitationsResult, OrganizationInviteValidationResult, ResendOrganizationInvitationCommand, ResendOrganizationInvitationResult, ValidateOrganizationInvitationsCommand } from "./invitations.types";
import { OrganizationMembershipError, OrganizationMembershipErrorKinds } from "./organization-members.errors";
import { _ParseAcceptOrganizationInvitationResult, _ParseCreateOrganizationInvitationsResult, _ParseOrganizationInviteValidation, _ParseOrganizationMemberDirectory, _ParseResendOrganizationInvitationResult } from "./organization-members.validator";

/** Operations whose Fleet error codes have different safe meanings. */
enum FleetOrganizationMembershipOperations
{
	/** Reads the active administrator directory. */
	Directory = "directory",
	/** Checks recipients, policy, seats, and payment without mutation. */
	Validate = "validate",
	/** Creates an idempotent invitation batch. */
	Create = "create",
	/** Rotates one pending invitation generation. */
	Resend = "resend",
	/** Consumes a token for the verified matching identity. */
	Accept = "accept",
}

/** Returns an allowlisted Fleet error code from the shared JSON envelope. */
function _fleetErrorCode(value: unknown): string | null
{
	if (typeof value !== "object" || value === null || !("error" in value)) return null;
	const error = value.error;
	if (typeof error !== "object" || error === null || !("code" in error) || typeof error.code !== "string") return null;
	return error.code;
}

/** Maps only operation-valid Fleet codes; unknown combinations fail as unavailable. */
function _errorKind(operation: FleetOrganizationMembershipOperations, status: number, value: unknown): OrganizationMembershipErrorKinds
{
	if (status === 401 || status === 403) return OrganizationMembershipErrorKinds.Forbidden;
	const code = _fleetErrorCode(value);
	if (code === "CONFLICT") return OrganizationMembershipErrorKinds.Conflict;
	if (code === "UNAVAILABLE") return OrganizationMembershipErrorKinds.Unavailable;
	if (code === "SEAT_OR_PAYMENT_REQUIRED" && operation !== FleetOrganizationMembershipOperations.Directory && operation !== FleetOrganizationMembershipOperations.Accept) return OrganizationMembershipErrorKinds.PaymentRequired;
	if (code === "ALREADY_USED" && (operation === FleetOrganizationMembershipOperations.Accept || operation === FleetOrganizationMembershipOperations.Resend)) return OrganizationMembershipErrorKinds.AlreadyUsed;
	if (code === "INVITATION_EXPIRED" && (operation === FleetOrganizationMembershipOperations.Accept || operation === FleetOrganizationMembershipOperations.Resend)) return OrganizationMembershipErrorKinds.Expired;
	if (code === "IDENTITY_MISMATCH" && operation === FleetOrganizationMembershipOperations.Accept) return OrganizationMembershipErrorKinds.IdentityMismatch;
	return OrganizationMembershipErrorKinds.Unavailable;
}

/**
 * Delegates every organisation directory and invitation decision to Fleet.
 *
 * This domain authority owns operation-specific error and response semantics. HTTP, credential
 * rotation, response limits, redirects, and timeouts remain behind its injected transport port.
 * Any transport or response-shape failure refuses closed and no local repository is available.
 *
 * Called by: apps/opencrane/src/app/organization-members-composition.ts in Fleet mode.
 * @implements OrganizationMembershipAuthority
 */
export class FleetOrganizationMembershipAuthority implements OrganizationMembershipAuthority
{
	/** Authenticated external-I/O port composed by the application. */
	private readonly transport: FleetOrganizationMembershipTransport;
	/** Exact silo Fleet must bind to the projected workload identity. */
	private readonly credentialSiloId: string;

	/** @param transport - Bounded projected-token-authenticated Fleet transport. */
	constructor(transport: FleetOrganizationMembershipTransport, credentialSiloId: string)
	{
		this.transport = transport;
		this.credentialSiloId = credentialSiloId;
	}

	/** @inheritdoc */
	async directory(caller: OrganizationMembershipCaller): Promise<OrganizationMemberDirectory>
	{
		return _ParseOrganizationMemberDirectory(await this._request(FleetOrganizationMembershipOperations.Directory, "/v1/organization/members", "GET", caller));
	}

	/** @inheritdoc */
	async validate(command: ValidateOrganizationInvitationsCommand): Promise<OrganizationInviteValidationResult>
	{
		return _ParseOrganizationInviteValidation(await this._request(FleetOrganizationMembershipOperations.Validate, "/v1/organization/members/invitations/validate", "POST", command.caller, { emails: command.emails }));
	}

	/** @inheritdoc */
	async create(command: CreateOrganizationInvitationsCommand): Promise<CreateOrganizationInvitationsResult>
	{
		return _ParseCreateOrganizationInvitationsResult(await this._request(FleetOrganizationMembershipOperations.Create, "/v1/organization/members/invitations", "POST", command.caller, { emails: command.emails, role: command.role }, command.idempotencyKey));
	}

	/** @inheritdoc */
	async resend(command: ResendOrganizationInvitationCommand): Promise<ResendOrganizationInvitationResult>
	{
		return _ParseResendOrganizationInvitationResult(await this._request(FleetOrganizationMembershipOperations.Resend, `/v1/organization/members/invitations/${encodeURIComponent(command.invitationId)}/resend`, "POST", command.caller, {}, command.idempotencyKey));
	}

	/** @inheritdoc */
	async accept(command: AcceptOrganizationInvitationCommand): Promise<AcceptOrganizationInvitationResult>
	{
		return _ParseAcceptOrganizationInvitationResult(await this._request(FleetOrganizationMembershipOperations.Accept, "/v1/organization/members/invitations/accept", "POST", command.caller, { token: command.token }));
	}

	/** Sends one operation through the injected transport and validates Fleet semantics. */
	private async _request(operation: FleetOrganizationMembershipOperations, path: string, method: "GET" | "POST", caller: OrganizationMembershipCaller, body?: object, idempotencyKey?: string): Promise<unknown>
	{
		if (caller.siloId !== this.credentialSiloId) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Forbidden, "Fleet membership workload identity does not belong to this silo");
		let response;
		const bodyProperty = body === undefined ? {} : { body };
		const idempotencyProperty = idempotencyKey === undefined ? {} : { idempotencyKey };
		try { response = await this.transport.request({ path, method, identity: caller, ...bodyProperty, ...idempotencyProperty }); }
		catch { throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Unavailable, "Fleet membership gateway is unavailable"); }
		if (response.status < 200 || response.status >= 300)
		{
			throw new OrganizationMembershipError(_errorKind(operation, response.status, response.body), "Fleet membership authority refused the request");
		}
		return response.body;
	}
}
