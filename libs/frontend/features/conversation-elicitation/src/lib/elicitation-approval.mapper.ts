import type { ElicitationApprovalPresentation } from "@opencrane/elements/elicitation";
import { ElicitationConnectionOwnerKinds, McpCredentialRequirement, ___ElicitationExecutionConnectionSchema, type ElicitationApprovalBody } from "@opencrane/state/conversation/elicitation";

/** Labels the saved connection owner without implying that the current participant owns it. */
const _OWNER_LABELS: Readonly<Record<ElicitationConnectionOwnerKinds, string>> = {
	[ElicitationConnectionOwnerKinds.Personal]: "Personal connection",
	[ElicitationConnectionOwnerKinds.CompanyAssistant]: "Company assistant",
};

/** Explains the server's credential requirement without naming an upstream account. */
const _CREDENTIAL_USE: Readonly<Record<McpCredentialRequirement, string>> = {
	[McpCredentialRequirement.Credentialless]: "No credentials required.",
	[McpCredentialRequirement.SharedCredential]: "Organisation-shared credential.",
	[McpCredentialRequirement.PrincipalCredential]: "Credential bound to this connection owner.",
};

/** Translate validated domain fields into the existing approval element's display text. */
export function _MapApprovalPresentation(body: ElicitationApprovalBody): ElicitationApprovalPresentation
{
	const { executionConnection, ...presentation } = body;
	const parsed = ___ElicitationExecutionConnectionSchema.safeParse(executionConnection);
	if (!parsed.success)
		return presentation;
	const connection = parsed.data;
	return { ...presentation, executionConnection: { owner: `${_OWNER_LABELS[connection.ownerKind]}: ${connection.ownerLabel}`, credentialUse: _CREDENTIAL_USE[connection.credentialRequirement] } };
}
