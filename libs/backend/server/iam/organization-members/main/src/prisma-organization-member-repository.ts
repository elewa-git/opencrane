import { randomUUID } from "node:crypto";

import { OrgMemberStatus, OrgRole, OrganizationInvitationStatus, Prisma } from "@prisma/client";

import type { OrganizationMembershipCaller } from "./authority.types";
import { OrganizationMemberRoles, OrganizationMemberStatuses, type OrganizationMember } from "./directory.types";
import { OrganizationInvitationStatuses, OrganizationInviteRecipientReasons, type OrganizationInviteRecipientValidation } from "./invitations.types";
import { OrganizationMembershipError, OrganizationMembershipErrorKinds } from "./organization-members.errors";
import type { AcceptStandaloneInvitationCommand, CreateStandaloneInvitationsCommand, CreateStandaloneInvitationsResult, OrganizationInvitationRecord, OrganizationMemberDirectoryRecords, OrganizationMemberTransactionRepository, ResendStandaloneInvitationCommand } from "./organization-member-repository.types";

/** Selects the persisted fields used by every invitation projection. */
const _INVITATION_SELECT = {
	id: true,
	siloId: true,
	email: true,
	role: true,
	status: true,
	generation: true,
	tokenNonce: true,
	expiresAt: true,
	invitedAt: true,
	invitedByDisplayName: true,
	acceptedBySubject: true,
} as const;

/** Maximum member or invitation rows returned in one settings directory page. */
const _DIRECTORY_ROW_LIMIT = 500;

/** Returns whether a normalized value is a complete email address. */
function _isEmail(value: string): boolean
{
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

/** Maps the Prisma role to the API vocabulary and refuses schema drift. */
function _role(role: OrgRole): OrganizationMemberRoles
{
	switch (role)
	{
		case OrgRole.Owner: return OrganizationMemberRoles.Owner;
		case OrgRole.Admin: return OrganizationMemberRoles.Admin;
		case OrgRole.Member: return OrganizationMemberRoles.Member;
	}
}

/** Maps the Prisma member state to the API vocabulary. */
function _memberStatus(status: OrgMemberStatus): OrganizationMemberStatuses
{
	return status === OrgMemberStatus.Active ? OrganizationMemberStatuses.Active : OrganizationMemberStatuses.Suspended;
}

/** Maps the stored invitation state, leaving expiry projection to the service clock. */
function _invitationStatus(status: OrganizationInvitationStatus): OrganizationInvitationRecord["status"]
{
	switch (status)
	{
		case OrganizationInvitationStatus.Pending: return OrganizationInvitationStatuses.Pending;
		case OrganizationInvitationStatus.Accepted: return OrganizationInvitationStatuses.Accepted;
		case OrganizationInvitationStatus.Failed: return OrganizationInvitationStatuses.Failed;
	}
}

/** Maps one Prisma invitation row to private domain coordinates. */
function _invitation(row: { id: string; siloId: string; email: string; role: OrgRole; status: OrganizationInvitationStatus; generation: number; tokenNonce: string; expiresAt: Date; invitedAt: Date; invitedByDisplayName: string }): OrganizationInvitationRecord
{
	const role = _role(row.role);
	if (role === OrganizationMemberRoles.Owner) throw new Error("stored organization invitation cannot assign owner");
	return { invitationId: row.id, siloId: row.siloId, email: row.email, role, status: _invitationStatus(row.status), generation: row.generation, nonce: row.tokenNonce, expiresAt: row.expiresAt, invitedAt: row.invitedAt, invitedByDisplayName: row.invitedByDisplayName };
}

/** Maps one local membership while marking the verified caller's row. */
function _member(row: { id: string; subject: string; email: string | null; displayName: string | null; role: OrgRole; status: OrgMemberStatus; createdAt: Date }, caller: OrganizationMembershipCaller): OrganizationMember
{
	const isCurrentUser = row.subject === caller.subjectId;
	const email = row.email ?? (isCurrentUser ? caller.verifiedEmail : null) ?? row.subject;
	const displayName = row.displayName ?? (isCurrentUser ? caller.displayName : null) ?? email;
	return { membershipId: row.id, displayName, email, role: _role(row.role), status: _memberStatus(row.status), joinedAt: row.createdAt.toISOString(), isCurrentUser };
}

/** Parses invitation identifiers stored in an idempotency JSON field. */
function _invitationIds(value: Prisma.JsonValue): readonly string[]
{
	if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error("invitation idempotency result is invalid");
	return value as string[];
}

/** Owns Prisma delegates only within the transaction supplied by its caller. */
export class PrismaOrganizationMemberRepository implements OrganizationMemberTransactionRepository
{
	/** Transaction-scoped database surface. */
	private readonly prisma: Prisma.TransactionClient;

	/** @param prisma - Caller-owned root client for reads or transaction client for mutations. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** @inheritdoc */
	async hasActiveMembership(caller: Pick<OrganizationMembershipCaller, "siloId" | "subjectId">): Promise<boolean>
	{
		const membership = await this.prisma.orgMembership.findUnique({
			where: { clusterTenant_subject: { clusterTenant: caller.siloId, subject: caller.subjectId } },
			select: { status: true },
		});
		return membership?.status === OrgMemberStatus.Active;
	}

	/** @inheritdoc */
	async directory(caller: OrganizationMembershipCaller): Promise<OrganizationMemberDirectoryRecords>
	{
		await this._requireActiveAdmin(caller);
		const now = new Date();
		const [members, invitations, activeCount, pendingCount] = await Promise.all([
			this.prisma.orgMembership.findMany({ where: { clusterTenant: caller.siloId }, orderBy: [{ role: "asc" }, { createdAt: "asc" }], take: _DIRECTORY_ROW_LIMIT, select: { id: true, subject: true, email: true, displayName: true, role: true, status: true, createdAt: true } }),
			this.prisma.organizationInvitation.findMany({ where: { siloId: caller.siloId }, orderBy: { invitedAt: "desc" }, take: _DIRECTORY_ROW_LIMIT, select: _INVITATION_SELECT }),
			this.prisma.orgMembership.count({ where: { clusterTenant: caller.siloId, status: OrgMemberStatus.Active } }),
			this.prisma.organizationInvitation.count({ where: { siloId: caller.siloId, status: OrganizationInvitationStatus.Pending, expiresAt: { gt: now } } }),
		]);
		return { members: members.map(row => _member(row, caller)), invitations: invitations.map(_invitation), activeCount, pendingCount };
	}

	/** @inheritdoc */
	async validate(caller: OrganizationMembershipCaller, emails: readonly string[], now: Date): Promise<readonly OrganizationInviteRecipientValidation[]>
	{
		await this._requireActiveAdmin(caller);
		const normalized = emails.map(email => email.trim().toLowerCase());
		const validEmails = normalized.filter(_isEmail);
		const [members, invitations] = await Promise.all([
			this.prisma.orgMembership.findMany({ where: { clusterTenant: caller.siloId, email: { in: validEmails } }, select: { email: true } }),
			this.prisma.organizationInvitation.findMany({ where: { siloId: caller.siloId, activeEmail: { in: validEmails }, status: OrganizationInvitationStatus.Pending, expiresAt: { gt: now } }, select: { email: true } }),
		]);
		const memberEmails = new Set(members.flatMap(row => row.email === null ? [] : [row.email]));
		const invitedEmails = new Set(invitations.map(row => row.email));
		return emails.map(function _ValidateEmail(email, index)
		{
			const normalizedEmail = normalized[index] ?? "";
			if (!_isEmail(normalizedEmail)) return { email, normalizedEmail, valid: false, reason: OrganizationInviteRecipientReasons.InvalidEmail };
			if (memberEmails.has(normalizedEmail)) return { email, normalizedEmail, valid: false, reason: OrganizationInviteRecipientReasons.AlreadyMember };
			if (invitedEmails.has(normalizedEmail)) return { email, normalizedEmail, valid: false, reason: OrganizationInviteRecipientReasons.AlreadyInvited };
			return { email, normalizedEmail, valid: true };
		});
	}

	/** @inheritdoc */
	async create(command: CreateStandaloneInvitationsCommand): Promise<CreateStandaloneInvitationsResult>
	{
		await this._requireActiveAdmin(command.caller);
		const prior = await this.prisma.organizationInvitationRequest.findUnique({ where: { siloId_actorSubject_idempotencyKey: { siloId: command.caller.siloId, actorSubject: command.caller.subjectId, idempotencyKey: command.idempotencyKey } } });
		if (prior !== null)
		{
			if (prior.payloadDigest !== command.payloadDigest) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Conflict, "idempotency key was already used with a different invitation request");
			return { invitations: await this._loadInvitations(command.caller.siloId, _invitationIds(prior.resultInvitationIds)), createdCount: 0 };
		}
		await this.prisma.organizationInvitation.updateMany({ where: { siloId: command.caller.siloId, status: OrganizationInvitationStatus.Pending, activeEmail: { not: null }, expiresAt: { lte: command.invitedAt } }, data: { activeEmail: null } });
		const validation = await this._validateInsideTransaction(command.caller.siloId, command.drafts.map(draft => draft.email), command.invitedAt);
		if (validation.some(result => !result.valid)) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Conflict, "one or more invitation recipients are no longer available");
		for (const draft of command.drafts)
		{
			await this.prisma.organizationInvitation.create({ data: { id: draft.invitationId, siloId: command.caller.siloId, email: draft.email, activeEmail: draft.email, role: command.role === OrganizationMemberRoles.Admin ? OrgRole.Admin : OrgRole.Member, tokenNonce: draft.nonce, invitedBySubject: command.caller.subjectId, invitedByDisplayName: command.caller.displayName, invitedAt: command.invitedAt, expiresAt: command.expiresAt } });
		}
		const ids = command.drafts.map(draft => draft.invitationId);
		await this.prisma.organizationInvitationRequest.create({ data: { siloId: command.caller.siloId, actorSubject: command.caller.subjectId, idempotencyKey: command.idempotencyKey, payloadDigest: command.payloadDigest, resultInvitationIds: [...ids], createdCount: ids.length } });
		await this.prisma.auditEntry.create({ data: { action: "organization.invitations.created", resource: command.caller.siloId, message: "Organization invitations created", metadata: { actorSubject: command.caller.subjectId, invitationIds: ids, recipientCount: ids.length } } });
		return { invitations: await this._loadInvitations(command.caller.siloId, ids), createdCount: ids.length };
	}

	/** @inheritdoc */
	async recoverCreate(command: CreateStandaloneInvitationsCommand): Promise<CreateStandaloneInvitationsResult | null>
	{
		const prior = await this.prisma.organizationInvitationRequest.findUnique({ where: { siloId_actorSubject_idempotencyKey: { siloId: command.caller.siloId, actorSubject: command.caller.subjectId, idempotencyKey: command.idempotencyKey } } });
		if (prior === null || prior.payloadDigest !== command.payloadDigest) return null;
		return { invitations: await this._loadInvitations(command.caller.siloId, _invitationIds(prior.resultInvitationIds)), createdCount: 0 };
	}

	/** @inheritdoc */
	async resend(command: ResendStandaloneInvitationCommand): Promise<OrganizationInvitationRecord>
	{
		await this._requireActiveAdmin(command.caller);
		const current = await this.prisma.organizationInvitation.findUnique({ where: { id: command.invitationId }, select: { ..._INVITATION_SELECT, lastResendIdempotencyKey: true } });
		if (current === null || current.siloId !== command.caller.siloId) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Conflict, "invitation is not available");
		if (current.status !== OrganizationInvitationStatus.Pending) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.AlreadyUsed, "invitation is no longer pending");
		if (current.lastResendIdempotencyKey === command.idempotencyKey) return _invitation(current);
		const changed = await this.prisma.organizationInvitation.updateMany({ where: { id: current.id, status: OrganizationInvitationStatus.Pending, generation: current.generation, tokenNonce: current.tokenNonce, lastResendIdempotencyKey: current.lastResendIdempotencyKey }, data: { generation: { increment: 1 }, tokenNonce: command.nonce, invitedAt: command.invitedAt, expiresAt: command.expiresAt, lastResendIdempotencyKey: command.idempotencyKey } });
		if (changed.count !== 1)
		{
			const winner = await this.prisma.organizationInvitation.findUnique({ where: { id: current.id }, select: { ..._INVITATION_SELECT, lastResendIdempotencyKey: true } });
			if (winner !== null && winner.lastResendIdempotencyKey === command.idempotencyKey) return _invitation(winner);
			throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Conflict, "invitation changed during resend");
		}
		const updated = await this.prisma.organizationInvitation.findUniqueOrThrow({ where: { id: current.id }, select: _INVITATION_SELECT });
		await this.prisma.auditEntry.create({ data: { action: "organization.invitation.resent", resource: current.id, message: "Organization invitation link rotated", metadata: { actorSubject: command.caller.subjectId, invitationId: current.id } } });
		return _invitation(updated);
	}

	/** @inheritdoc */
	async accept(command: AcceptStandaloneInvitationCommand): Promise<OrganizationMember>
	{
		const current = await this.prisma.organizationInvitation.findUnique({ where: { id: command.coordinates.invitationId }, select: _INVITATION_SELECT });
		if (current === null || current.siloId !== command.caller.siloId) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Invalid, "invitation token is invalid");
		if (current.status === OrganizationInvitationStatus.Accepted)
		{
			if (current.generation !== command.coordinates.generation || current.tokenNonce !== command.coordinates.nonce || current.acceptedBySubject !== command.caller.subjectId || current.email !== command.caller.verifiedEmail) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.AlreadyUsed, "invitation was already consumed");
			const recovered = await this.prisma.orgMembership.findUnique({ where: { clusterTenant_subject: { clusterTenant: current.siloId, subject: command.caller.subjectId } }, select: { id: true, subject: true, email: true, displayName: true, role: true, status: true, createdAt: true } });
			if (recovered === null || recovered.subject !== current.acceptedBySubject || recovered.email !== command.caller.verifiedEmail) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.AlreadyUsed, "invitation acceptance result is unavailable");
			return _member(recovered, command.caller);
		}
		if (current.status !== OrganizationInvitationStatus.Pending) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.AlreadyUsed, "invitation was already consumed");
		if (current.generation !== command.coordinates.generation || current.tokenNonce !== command.coordinates.nonce) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.AlreadyUsed, "invitation generation is no longer current");
		if (current.expiresAt.getTime() <= command.acceptedAt.getTime()) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Expired, "invitation has expired");
		if (current.email !== command.caller.verifiedEmail) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.IdentityMismatch, "verified email does not match invitation recipient");
		const existing = await this.prisma.orgMembership.findUnique({ where: { clusterTenant_subject: { clusterTenant: command.caller.siloId, subject: command.caller.subjectId } } });
		if (existing !== null) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Conflict, "verified subject already has an organization membership");
		const changed = await this.prisma.organizationInvitation.updateMany({ where: { id: current.id, status: OrganizationInvitationStatus.Pending, generation: current.generation, tokenNonce: current.tokenNonce, activeEmail: current.email }, data: { status: OrganizationInvitationStatus.Accepted, activeEmail: null, acceptedAt: command.acceptedAt, acceptedBySubject: command.caller.subjectId } });
		if (changed.count !== 1) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Conflict, "invitation changed during acceptance");
		const membership = await this.prisma.orgMembership.create({ data: { id: randomUUID(), clusterTenant: command.caller.siloId, subject: command.caller.subjectId, email: command.caller.verifiedEmail, displayName: command.caller.displayName, role: current.role, status: OrgMemberStatus.Active }, select: { id: true, subject: true, email: true, displayName: true, role: true, status: true, createdAt: true } });
		await this.prisma.auditEntry.create({ data: { action: "organization.invitation.accepted", resource: current.id, message: "Organization invitation accepted", metadata: { invitationId: current.id, acceptedBySubject: command.caller.subjectId, membershipId: membership.id } } });
		return _member(membership, command.caller);
	}

	/** Requires current active Owner or Admin state from the host-selected silo. */
	private async _requireActiveAdmin(caller: OrganizationMembershipCaller): Promise<void>
	{
		const membership = await this.prisma.orgMembership.findFirst({ where: { clusterTenant: caller.siloId, subject: caller.subjectId, status: OrgMemberStatus.Active, role: { in: [OrgRole.Owner, OrgRole.Admin] } }, select: { id: true } });
		if (membership === null) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Forbidden, "active organization administrator membership is required");
	}

	/** Reads ordered invitation rows and fails when an idempotency record is inconsistent. */
	private async _loadInvitations(siloId: string, ids: readonly string[]): Promise<readonly OrganizationInvitationRecord[]>
	{
		const rows = await this.prisma.organizationInvitation.findMany({ where: { siloId, id: { in: [...ids] } }, select: _INVITATION_SELECT });
		const byId = new Map(rows.map(row => [row.id, row]));
		return ids.map(function _MapInvitationId(id)
		{
			const row = byId.get(id);
			if (row === undefined) throw new Error("invitation idempotency record points to a missing invitation");
			return _invitation(row);
		});
	}

	/** Rechecks recipient races inside the create transaction without reopening authorization. */
	private async _validateInsideTransaction(siloId: string, emails: readonly string[], now: Date): Promise<readonly OrganizationInviteRecipientValidation[]>
	{
		const [members, invitations] = await Promise.all([
			this.prisma.orgMembership.findMany({ where: { clusterTenant: siloId, email: { in: [...emails] } }, select: { email: true } }),
			this.prisma.organizationInvitation.findMany({ where: { siloId, activeEmail: { in: [...emails] }, status: OrganizationInvitationStatus.Pending, expiresAt: { gt: now } }, select: { email: true } }),
		]);
		const memberEmails = new Set(members.flatMap(row => row.email === null ? [] : [row.email]));
		const invitedEmails = new Set(invitations.map(row => row.email));
		return emails.map(function _Validate(email)
		{
			if (!_isEmail(email)) return { email, normalizedEmail: email, valid: false, reason: OrganizationInviteRecipientReasons.InvalidEmail };
			if (memberEmails.has(email)) return { email, normalizedEmail: email, valid: false, reason: OrganizationInviteRecipientReasons.AlreadyMember };
			if (invitedEmails.has(email)) return { email, normalizedEmail: email, valid: false, reason: OrganizationInviteRecipientReasons.AlreadyInvited };
			return { email, normalizedEmail: email, valid: true };
		});
	}
}
