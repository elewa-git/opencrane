import { describe, expect, it } from "vitest";

import { ElicitationBodyKinds, ElicitationConnectionOwnerKinds, McpCredentialRequirement, type ElicitationApprovalBody } from "@opencrane/state/conversation/elicitation";

import { _MapApprovalPresentation } from "../elicitation-approval.mapper";

/** Keep original action fields while isolating ownership display mapping. */
const _BODY: ElicitationApprovalBody = { kind: ElicitationBodyKinds.Approval, prompt: "Proceed?", action: "Create event", target: "Calendar", dataUse: "Meeting details", proposedArguments: { title: "Planning" }, externalSystem: "Calendar server", consequence: "An invitation is sent.", cost: "No additional fee" };

describe("approval presentation mapping", function _mapperSuite()
{
	it.each([[ElicitationConnectionOwnerKinds.Personal, "Personal connection: Amina"], [ElicitationConnectionOwnerKinds.CompanyAssistant, "Company assistant: Amina"]])("names the saved %s connection independently of the respondent", function _owner(ownerKind, owner)
	{
		const presentation = _MapApprovalPresentation({ ..._BODY, executionConnection: { ownerKind: ownerKind as ElicitationConnectionOwnerKinds, ownerLabel: "Amina", credentialRequirement: McpCredentialRequirement.PrincipalCredential } });
		expect(presentation).toEqual({ ..._BODY, executionConnection: { owner, credentialUse: "Credential bound to this connection owner." } });
	});

	it.each([[McpCredentialRequirement.Credentialless, "No credentials required."], [McpCredentialRequirement.SharedCredential, "Organisation-shared credential."], [McpCredentialRequirement.PrincipalCredential, "Credential bound to this connection owner."]])("explains %s without inventing an upstream account", function _credentials(credentialRequirement, credentialUse)
	{
		const presentation = _MapApprovalPresentation({ ..._BODY, executionConnection: { ownerKind: ElicitationConnectionOwnerKinds.CompanyAssistant, ownerLabel: "Finance assistant", credentialRequirement: credentialRequirement as McpCredentialRequirement } });
		expect(presentation.executionConnection).toEqual({ owner: "Company assistant: Finance assistant", credentialUse });
	});

	it("does not invent connection details for non-tool approvals", function _omitted()
	{
		expect(_MapApprovalPresentation(_BODY)).toEqual(_BODY);
	});
});
