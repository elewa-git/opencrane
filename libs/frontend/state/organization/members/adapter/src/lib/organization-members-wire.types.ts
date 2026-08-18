import type { paths } from "@opencrane/contracts";

/** Generated directory response projected from the shared OpenAPI contract. */
export type OrganizationMemberDirectoryWire = paths["/organization/members"]["get"]["responses"][200]["content"]["application/json"];
/** Generated validation response projected from the shared OpenAPI contract. */
export type OrganizationInviteValidationWire = paths["/organization/members/invitations/validate"]["post"]["responses"][200]["content"]["application/json"];
/** Generated create response projected from the shared OpenAPI contract. */
export type OrganizationInviteCreateWire = paths["/organization/members/invitations"]["post"]["responses"][201]["content"]["application/json"];
/** Generated resend response projected from the shared OpenAPI contract. */
export type OrganizationInviteResendWire = paths["/organization/members/invitations/{invitationId}/resend"]["post"]["responses"][200]["content"]["application/json"];
/** Generated acceptance response projected from the shared OpenAPI contract. */
export type OrganizationInviteAcceptanceWire = paths["/organization/members/invitations/accept"]["post"]["responses"][200]["content"]["application/json"];
