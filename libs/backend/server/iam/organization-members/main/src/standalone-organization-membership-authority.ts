import { createHash, randomBytes, randomUUID } from "node:crypto";

import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { OrganizationMembershipAuthority, OrganizationMembershipCaller } from "./authority.types";
import { OrganizationMemberStatuses, OrganizationMemberRoles, type OrganizationMemberDirectory } from "./directory.types";
import type { StandaloneOrganizationMembershipConfig } from "./deployment.types";
import { OrganizationInvitationStatuses, type AcceptOrganizationInvitationCommand, type AcceptOrganizationInvitationResult, type CreateOrganizationInvitationsCommand, type CreateOrganizationInvitationsResult, type OrganizationInvitation, type OrganizationInviteValidationResult, type ResendOrganizationInvitationCommand, type ResendOrganizationInvitationResult, type ValidateOrganizationInvitationsCommand } from "./invitations.types";
import type { OrganizationInvitationTokenAuthority } from "./invitation-token.types";
import { OrganizationMembershipError, OrganizationMembershipErrorKinds } from "./organization-members.errors";
import type { OrganizationInvitationRecord, OrganizationMemberRepository } from "./organization-member-repository.types";

/** Maximum recipients admitted in one idempotent request. */
const _MAXIMUM_RECIPIENTS = 50;

/** Returns a normalized de-duplicated recipient list without trusting earlier validation. */
function _normalizedEmails(emails: readonly string[]): readonly string[]
{
	return [...new Set(emails.map(email => email.trim().toLowerCase()))];
}

/** Returns whether one normalized recipient is a complete email address. */
function _isEmail(value: string): boolean
{
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

/** Requires an opaque retry coordinate with enough entropy and bounded storage. */
function _requireIdempotencyKey(value: string): void
{
	if (value.length < 16 || value.length > 128 || /\s/u.test(value)) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Invalid, "Idempotency-Key must contain 16 through 128 non-space characters");
}

/** Builds the stable digest that detects an idempotency key reused with different inputs. */
function _payloadDigest(emails: readonly string[], role: OrganizationMemberRoles): string
{
	return `sha256:${createHash("sha256").update(JSON.stringify({ emails: [...emails].sort(), role }), "utf8").digest("hex")}`;
}

/** Projects a private invitation record and derives expiry from the authority clock. */
function _projectInvitation(record: OrganizationInvitationRecord, now: Date, inviteLink?: string): OrganizationInvitation
{
	let status: OrganizationInvitationStatuses = record.status;
	if (status === OrganizationInvitationStatuses.Pending && record.expiresAt.getTime() <= now.getTime()) status = OrganizationInvitationStatuses.Expired;
	return { invitationId: record.invitationId, email: record.email, role: record.role, status, expiresAt: record.expiresAt.toISOString(), invitedAt: record.invitedAt.toISOString(), invitedByDisplayName: record.invitedByDisplayName, ...(inviteLink === undefined ? {} : { inviteLink }) };
}

/**
 * Owns local organisation membership and invitation behaviour for standalone deployments.
 *
 * The selected repository rechecks active admin state inside each mutation. Tokens are authenticated
 * with deployment-held key material, and acceptance still needs a verified matching OIDC email. No
 * method consults Fleet, so the application must never construct this class in Fleet mode.
 *
 * Called by: apps/opencrane/src/app/organization-members-composition.ts.
 * @implements OrganizationMembershipAuthority
 */
export class StandaloneOrganizationMembershipAuthority implements OrganizationMembershipAuthority
{
	/** Local database port. */
	private readonly repository: OrganizationMemberRepository;
	/** Restart-stable token authority. */
	private readonly tokens: OrganizationInvitationTokenAuthority;
	/** Deployment-fixed standalone settings. */
	private readonly config: StandaloneOrganizationMembershipConfig;

	/** @param repository - Local member and invitation persistence. @param tokens - Mounted-key token authority. @param config - Frozen standalone settings. */
	constructor(repository: OrganizationMemberRepository, tokens: OrganizationInvitationTokenAuthority, config: StandaloneOrganizationMembershipConfig)
	{
		this.repository = repository;
		this.tokens = tokens;
		this.config = config;
	}

	/** @inheritdoc */
	async directory(caller: OrganizationMembershipCaller): Promise<OrganizationMemberDirectory>
	{
		const records = await ___DoWithTrace("organization.members.directory", { siloId: caller.siloId, mode: "standalone" }, async () => this.repository.directory(caller));
		const now = new Date();
		const invitations = records.invitations.map(record => _projectInvitation(record, now));
		return { members: records.members, invitations, activeCount: records.activeCount, pendingCount: records.pendingCount };
	}

	/** @inheritdoc */
	async validate(command: ValidateOrganizationInvitationsCommand): Promise<OrganizationInviteValidationResult>
	{
		if (command.emails.length === 0 || command.emails.length > _MAXIMUM_RECIPIENTS) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Invalid, "one through 50 recipient emails are required");
		const recipients = await ___DoWithTrace("organization.invitations.validate", { siloId: command.caller.siloId, recipientCount: command.emails.length, mode: "standalone" }, async () => this.repository.validate(command.caller, command.emails, new Date()));
		return { recipients };
	}

	/** @inheritdoc */
	async create(command: CreateOrganizationInvitationsCommand): Promise<CreateOrganizationInvitationsResult>
	{
		_requireIdempotencyKey(command.idempotencyKey);
		const emails = _normalizedEmails(command.emails);
		if (emails.length === 0 || emails.length > _MAXIMUM_RECIPIENTS) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Invalid, "one through 50 unique recipient emails are required");
		if (emails.some(email => !_isEmail(email))) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Invalid, "every invitation recipient must be a complete email address");
		const invitedAt = new Date();
		const result = await ___DoWithTrace("organization.invitations.create", { siloId: command.caller.siloId, recipientCount: emails.length, mode: "standalone" }, async () => this.repository.create({ caller: command.caller, role: command.role, idempotencyKey: command.idempotencyKey, payloadDigest: _payloadDigest(emails, command.role), drafts: emails.map(email => ({ invitationId: randomUUID(), email, nonce: randomBytes(24).toString("base64url") })), invitedAt, expiresAt: new Date(invitedAt.getTime() + this.config.invitationTtlMilliseconds) }));
		const links = result.invitations.map(record => this._link(record));
		return { invitations: result.invitations.map((record, index) => _projectInvitation(record, invitedAt, links[index])), createdCount: result.createdCount, inviteLinks: links };
	}

	/** @inheritdoc */
	async resend(command: ResendOrganizationInvitationCommand): Promise<ResendOrganizationInvitationResult>
	{
		_requireIdempotencyKey(command.idempotencyKey);
		const invitedAt = new Date();
		const record = await ___DoWithTrace("organization.invitation.resend", { siloId: command.caller.siloId, invitationId: command.invitationId, mode: "standalone" }, async () => this.repository.resend({ caller: command.caller, invitationId: command.invitationId, idempotencyKey: command.idempotencyKey, nonce: randomBytes(24).toString("base64url"), invitedAt, expiresAt: new Date(invitedAt.getTime() + this.config.invitationTtlMilliseconds) }));
		const inviteLink = this._link(record);
		return { invitation: _projectInvitation(record, invitedAt, inviteLink), inviteLink };
	}

	/** @inheritdoc */
	async accept(command: AcceptOrganizationInvitationCommand): Promise<AcceptOrganizationInvitationResult>
	{
		if (command.caller.verifiedEmail === null) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.IdentityMismatch, "a verified OIDC email is required to accept an invitation");
		const coordinates = this.tokens.verify(command.token);
		if (coordinates === null) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Invalid, "invitation token is invalid");
		const caller = command.caller as OrganizationMembershipCaller & { readonly verifiedEmail: string };
		const member = await ___DoWithTrace("organization.invitation.accept", { siloId: caller.siloId, invitationId: coordinates.invitationId, mode: "standalone" }, async () => this.repository.accept({ caller, coordinates, acceptedAt: new Date() }));
		return { member };
	}

	/** Authors one absolute shareable link from deployment config and signed coordinates. */
	private _link(record: OrganizationInvitationRecord): string
	{
		const token = this.tokens.issue({ invitationId: record.invitationId, generation: record.generation, nonce: record.nonce });
		const link = new URL("/invite", this.config.publicBaseUrl);
		link.searchParams.set("token", token);
		return link.toString();
	}
}
