import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationConnectionOwnerKinds, ElicitationPurposes, ElicitationRequestStates, McpCredentialRequirement, ___ElicitationExecutionConnectionSchema } from "@opencrane/contracts";

import { _ElicitationOpenapiPaths } from "../openapi";

const _SCHEMA = _ElicitationOpenapiPaths["/me/conversations/{conversationId}/elicitations/{requestId}"].get.responses[200].content["application/json"].schema.properties.elicitation;
const _VALIDATE = new Ajv({ strict: false, validateFormats: false }).compile(_SCHEMA);
const _CONNECTION = { ownerKind: ElicitationConnectionOwnerKinds.CompanyAssistant, ownerLabel: "Inventory assistant", credentialRequirement: McpCredentialRequirement.PrincipalCredential };
const _BODY = { kind: ElicitationBodyKinds.Approval, prompt: "Allow this?", action: "Invoke tool", target: "Update stock", dataUse: "Sends the reviewed arguments.", consequence: "Updates the record once.", proposedArguments: { quantity: 4 }, executionConnection: _CONNECTION };
const _REQUEST = { version: CONVERSATION_ELICITATION_VERSION, requestId: "request-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, assignedParticipantId: "user-1", purpose: ElicitationPurposes.ToolApproval, state: ElicitationRequestStates.Requested, body: _BODY, requiresStepUp: true, requestedAt: "2026-09-22T10:00:00.000Z", expiresAt: "2026-09-22T10:05:00.000Z" };

describe("elicitation connection disclosure OpenAPI", function _Suite()
{
	it("requires the connection and reviewed argument fields for tool approvals", function _Required()
	{
		expect(_VALIDATE(_REQUEST)).toBe(true);
		for (const field of ["executionConnection", "proposedArguments"])
		{
			const body: Record<string, unknown> = { ..._BODY };
			delete body[field];
			expect(_VALIDATE({ ..._REQUEST, body })).toBe(false);
		}
		expect(_VALIDATE({ ..._REQUEST, body: { ..._BODY, proposedArguments: null } })).toBe(true);
	});
	it("omits connection disclosure from other approval purposes", function _OtherPurpose()
	{
		const { executionConnection: _, ...body } = _BODY;
		expect(_VALIDATE({ ..._REQUEST, purpose: ElicitationPurposes.A2uiAction, body })).toBe(true);
		expect(_VALIDATE({ ..._REQUEST, purpose: ElicitationPurposes.A2uiAction })).toBe(false);
	});
	it.each([_CONNECTION, { ..._CONNECTION, ownerLabel: "Équipe <script> & Amina" }, { ..._CONNECTION, ownerLabel: " " }, { ..._CONNECTION, ownerLabel: "x".repeat(201) }, { ..._CONNECTION, ownerLabel: "owner\u202Eadmin" }, { ..._CONNECTION, ownerLabel: "owner\nadmin" }, { ..._CONNECTION, ownerKind: "admin" }, { ..._CONNECTION, credentialRequirement: "optional" }, { ..._CONNECTION, credentialSecretUid: "private" }])("matches the shared runtime disclosure validator", function _Parity(executionConnection)
	{
		expect(_VALIDATE({ ..._REQUEST, body: { ..._BODY, executionConnection } })).toBe(___ElicitationExecutionConnectionSchema.safeParse(executionConnection).success);
	});
});
