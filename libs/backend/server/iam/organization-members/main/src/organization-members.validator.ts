import { z } from "zod";

import { OrganizationMemberRoles, OrganizationMemberStatuses, type OrganizationMember, type OrganizationMemberDirectory } from "./directory.types";
import { OrganizationInvitationStatuses, OrganizationInviteRecipientReasons, type AcceptOrganizationInvitationResult, type CreateOrganizationInvitationsResult, type OrganizationInvitation, type OrganizationInviteValidationResult, type ResendOrganizationInvitationResult } from "./invitations.types";

/** This validator is the trust boundary for Fleet responses and must change with the domain models. */
const _OrganizationMemberSchema: z.ZodType<OrganizationMember> = z.object({ membershipId: z.string().min(1), displayName: z.string().min(1), email: z.string().email(), role: z.nativeEnum(OrganizationMemberRoles), status: z.nativeEnum(OrganizationMemberStatuses), joinedAt: z.string().datetime(), isCurrentUser: z.boolean() }).strict();

/** Validates one invitation without admitting a browser-authored owner role. */
const _OrganizationInvitationSchema: z.ZodType<OrganizationInvitation> = z.object({ invitationId: z.string().min(1), email: z.string().email(), role: z.union([z.literal(OrganizationMemberRoles.Admin), z.literal(OrganizationMemberRoles.Member)]), status: z.nativeEnum(OrganizationInvitationStatuses), expiresAt: z.string().datetime(), invitedAt: z.string().datetime(), invitedByDisplayName: z.string().min(1), inviteLink: z.string().url().optional() }).strict();

/** Validates the Fleet directory response before it becomes local API data. */
const _OrganizationMemberDirectorySchema: z.ZodType<OrganizationMemberDirectory> = z.object({ members: z.array(_OrganizationMemberSchema), invitations: z.array(_OrganizationInvitationSchema), activeCount: z.number().int().nonnegative(), pendingCount: z.number().int().nonnegative() }).strict();

/** Validates every Fleet recipient decision. */
const _OrganizationInviteValidationSchema: z.ZodType<OrganizationInviteValidationResult> = z.object({ recipients: z.array(z.object({ email: z.string(), normalizedEmail: z.string(), valid: z.boolean(), reason: z.nativeEnum(OrganizationInviteRecipientReasons).optional() }).strict()) }).strict();

/** Validates a Fleet create result including its server-authored links. */
const _CreateOrganizationInvitationsResultSchema: z.ZodType<CreateOrganizationInvitationsResult> = z.object({ invitations: z.array(_OrganizationInvitationSchema), createdCount: z.number().int().nonnegative(), inviteLinks: z.array(z.string().url()) }).strict();

/** Validates a Fleet resend result. */
const _ResendOrganizationInvitationResultSchema: z.ZodType<ResendOrganizationInvitationResult> = z.object({ invitation: _OrganizationInvitationSchema, inviteLink: z.string().url() }).strict();

/** Validates a Fleet acceptance result. */
const _AcceptOrganizationInvitationResultSchema: z.ZodType<AcceptOrganizationInvitationResult> = z.object({ member: _OrganizationMemberSchema }).strict();

/** Parses an untrusted Fleet directory response or throws closed. */
export function _ParseOrganizationMemberDirectory(value: unknown): OrganizationMemberDirectory { return _OrganizationMemberDirectorySchema.parse(value); }

/** Parses an untrusted Fleet validation response or throws closed. */
export function _ParseOrganizationInviteValidation(value: unknown): OrganizationInviteValidationResult { return _OrganizationInviteValidationSchema.parse(value); }

/** Parses an untrusted Fleet create response or throws closed. */
export function _ParseCreateOrganizationInvitationsResult(value: unknown): CreateOrganizationInvitationsResult { return _CreateOrganizationInvitationsResultSchema.parse(value); }

/** Parses an untrusted Fleet resend response or throws closed. */
export function _ParseResendOrganizationInvitationResult(value: unknown): ResendOrganizationInvitationResult { return _ResendOrganizationInvitationResultSchema.parse(value); }

/** Parses an untrusted Fleet acceptance response or throws closed. */
export function _ParseAcceptOrganizationInvitationResult(value: unknown): AcceptOrganizationInvitationResult { return _AcceptOrganizationInvitationResultSchema.parse(value); }
