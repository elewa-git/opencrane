import { OrganizationInvitationStatuses, OrganizationInviteRecipientReasons } from "./invitations.types";
import { OrganizationMemberRoles, OrganizationMemberStatuses } from "./directory.types";

/** Reusable successful response helper for package-owned paths. */
function _ok(description: string, schema: object)
{
	return { description, content: { "application/json": { schema } } };
}

/** Shared error response used for denied, conflicting, and unavailable authority. */
const _ErrorResponse = { description: "Organization membership authority refused or could not complete the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };

/** OpenAPI schemas exported into the server's component registry. */
export const _OrganizationMembersOpenapiSchemas = {
	OrganizationMember: {
		type: "object", additionalProperties: false, required: ["membershipId", "displayName", "email", "role", "status", "joinedAt", "isCurrentUser"],
		properties: { membershipId: { type: "string" }, displayName: { type: "string" }, email: { type: "string", format: "email" }, role: { type: "string", enum: Object.values(OrganizationMemberRoles) }, status: { type: "string", enum: Object.values(OrganizationMemberStatuses) }, joinedAt: { type: "string", format: "date-time" }, isCurrentUser: { type: "boolean" } },
	},
	OrganizationInvitation: {
		type: "object", additionalProperties: false, required: ["invitationId", "email", "role", "status", "expiresAt", "invitedAt", "invitedByDisplayName"],
		properties: { invitationId: { type: "string" }, email: { type: "string", format: "email" }, role: { type: "string", enum: [OrganizationMemberRoles.Admin, OrganizationMemberRoles.Member] }, status: { type: "string", enum: Object.values(OrganizationInvitationStatuses) }, expiresAt: { type: "string", format: "date-time" }, invitedAt: { type: "string", format: "date-time" }, invitedByDisplayName: { type: "string" }, inviteLink: { type: "string", format: "uri" } },
	},
	OrganizationMemberDirectory: { type: "object", additionalProperties: false, required: ["members", "invitations", "activeCount", "pendingCount"], properties: { members: { type: "array", items: { $ref: "#/components/schemas/OrganizationMember" } }, invitations: { type: "array", items: { $ref: "#/components/schemas/OrganizationInvitation" } }, activeCount: { type: "integer", minimum: 0 }, pendingCount: { type: "integer", minimum: 0 } } },
	OrganizationInviteValidationResult: { type: "object", additionalProperties: false, required: ["recipients"], properties: { recipients: { type: "array", items: { type: "object", additionalProperties: false, required: ["email", "normalizedEmail", "valid"], properties: { email: { type: "string" }, normalizedEmail: { type: "string" }, valid: { type: "boolean" }, reason: { type: "string", enum: Object.values(OrganizationInviteRecipientReasons) } } } } } },
	CreateOrganizationInvitationsResult: { type: "object", additionalProperties: false, required: ["invitations", "createdCount", "inviteLinks"], properties: { invitations: { type: "array", items: { $ref: "#/components/schemas/OrganizationInvitation" } }, createdCount: { type: "integer", minimum: 0 }, inviteLinks: { type: "array", items: { type: "string", format: "uri" } } } },
	ResendOrganizationInvitationResult: { type: "object", additionalProperties: false, required: ["invitation", "inviteLink"], properties: { invitation: { $ref: "#/components/schemas/OrganizationInvitation" }, inviteLink: { type: "string", format: "uri" } } },
	AcceptOrganizationInvitationResult: { type: "object", additionalProperties: false, required: ["member"], properties: { member: { $ref: "#/components/schemas/OrganizationMember" } } },
} as const;

/** Authenticated organisation-member paths mounted below `/api/v1`. */
export const _OrganizationMembersOpenapiPaths = {
	"/organization/members": {
		get: { operationId: "getOrganizationMemberDirectory", summary: "Read the current organization member and invitation directory", tags: ["Organization members"], responses: { 200: _ok("Authoritative directory.", { $ref: "#/components/schemas/OrganizationMemberDirectory" }), 403: _ErrorResponse, 503: _ErrorResponse } },
	},
	"/organization/members/invitations/validate": {
		post: { operationId: "validateOrganizationInvitations", summary: "Validate organization invitation recipients", tags: ["Organization members"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["emails"], properties: { emails: { type: "array", minItems: 1, maxItems: 50, items: { type: "string", maxLength: 320 } } } } } } }, responses: { 200: _ok("Recipient validation.", { $ref: "#/components/schemas/OrganizationInviteValidationResult" }), 400: _ErrorResponse, 402: _ErrorResponse, 403: _ErrorResponse, 503: _ErrorResponse } },
	},
	"/organization/members/invitations": {
		post: { operationId: "createOrganizationInvitations", summary: "Create an idempotent organization invitation batch", tags: ["Organization members"], parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 16, maxLength: 128 } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["emails", "role"], properties: { emails: { type: "array", minItems: 1, maxItems: 50, items: { type: "string", maxLength: 320 } }, role: { type: "string", enum: [OrganizationMemberRoles.Admin, OrganizationMemberRoles.Member] } } } } } }, responses: { 200: _ok("Recovered idempotent result.", { $ref: "#/components/schemas/CreateOrganizationInvitationsResult" }), 201: _ok("Created invitation result.", { $ref: "#/components/schemas/CreateOrganizationInvitationsResult" }), 400: _ErrorResponse, 402: _ErrorResponse, 403: _ErrorResponse, 409: _ErrorResponse, 503: _ErrorResponse } },
	},
	"/organization/members/invitations/{invitationId}/resend": {
		post: { operationId: "resendOrganizationInvitation", summary: "Rotate an organization invitation link idempotently", tags: ["Organization members"], parameters: [{ name: "invitationId", in: "path", required: true, schema: { type: "string" } }, { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 16, maxLength: 128 } }], responses: { 200: _ok("Rotated or recovered invitation.", { $ref: "#/components/schemas/ResendOrganizationInvitationResult" }), 400: _ErrorResponse, 402: _ErrorResponse, 403: _ErrorResponse, 409: _ErrorResponse, 503: _ErrorResponse } },
	},
	"/organization/members/invitations/accept": {
		post: { operationId: "acceptOrganizationInvitation", summary: "Accept an invitation using the signed-in verified email", tags: ["Organization members"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["token"], properties: { token: { type: "string", minLength: 32, maxLength: 2048 } } } } } }, responses: { 200: _ok("Created membership.", { $ref: "#/components/schemas/AcceptOrganizationInvitationResult" }), 400: _ErrorResponse, 403: _ErrorResponse, 409: _ErrorResponse, 410: _ErrorResponse, 422: _ErrorResponse, 503: _ErrorResponse } },
	},
} as const;
