import { describe, expect, it } from "vitest";

import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationConnectionOwnerKinds, ElicitationPurposes, ElicitationRequestStates, McpCredentialRequirement } from "@opencrane/contracts";

import { __ParseConversationElicitation } from "../elicitation-response.validator";

/** Build untrusted tool disclosure input without passing it through a typed gateway double. */
function _request(executionConnection: unknown): Record<string, unknown>
{
	return { version: CONVERSATION_ELICITATION_VERSION, requestId: "request-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, assignedParticipantId: "user-1", purpose: ElicitationPurposes.ToolApproval, state: ElicitationRequestStates.Requested, body: { kind: ElicitationBodyKinds.Approval, prompt: "Create this event?", action: "Create event", target: "Calendar", dataUse: "Meeting details", proposedArguments: { title: "Planning" }, executionConnection, consequence: "Invitees receive an invitation." }, requiresStepUp: false, requestedAt: "2026-09-22T08:00:00.000Z", expiresAt: "2026-09-22T09:00:00.000Z" };
}

/** Describe a connection without IDs, endpoints, credentials, or an inferred external account. */
const _CONNECTION = { ownerKind: ElicitationConnectionOwnerKinds.CompanyAssistant, ownerLabel: "Finance assistant", credentialRequirement: McpCredentialRequirement.PrincipalCredential };

describe("elicitation connection response parsing", function _connectionSuite()
{
	for (const ownerKind of Object.values(ElicitationConnectionOwnerKinds))
	{
		for (const credentialRequirement of Object.values(McpCredentialRequirement))
		{
			it(`preserves ${ownerKind} with ${credentialRequirement}`, function _preservesDisclosure()
			{
				const connection = { ..._CONNECTION, ownerKind, credentialRequirement };
				const request = _request(connection);
				expect(__ParseConversationElicitation(request)).toEqual(request);
			});
		}
	}

	it.each([undefined, null, {}, { ..._CONNECTION, ownerKind: "administrator" }, { ..._CONNECTION, credentialRequirement: "borrow_requester" }, { ..._CONNECTION, ownerLabel: " " }, { ..._CONNECTION, ownerLabel: "a".repeat(201) }, { ..._CONNECTION, ownerLabel: "Amina\u202E" }, { ..._CONNECTION, secretUid: "hidden-secret" }, { ..._CONNECTION, endpoint: "https://example.test/mcp" }])("rejects incomplete or unknown disclosure fields: %j", function _rejectsDisclosure(connection)
	{
		expect(function _parse() { __ParseConversationElicitation(_request(connection)); }).toThrow("elicitation connection disclosure is invalid");
	});

	it("rejects an entirely omitted tool connection", function _missingDisclosure()
	{
		const request = _request(_CONNECTION);
		const body = request["body"] as Record<string, unknown>;
		delete body["executionConnection"];
		expect(function _parse() { __ParseConversationElicitation(request); }).toThrow("tool approval connection disclosure is missing");
	});

	it("does not accept a tool approval disguised as another interaction kind", function _wrongBody()
	{
		const request = { ..._request(_CONNECTION), body: { kind: ElicitationBodyKinds.FreeText, prompt: "Continue?", maximumLength: 100, allowEmpty: false } };
		expect(function _parse() { __ParseConversationElicitation(request); }).toThrow("tool approval connection disclosure is missing");
	});

	it("requires non-tool approvals to omit execution connection details", function _nonToolApproval()
	{
		const request = { ..._request(_CONNECTION), purpose: ElicitationPurposes.RuntimeInput };
		expect(function _parse() { __ParseConversationElicitation(request); }).toThrow("connection disclosure is only supported for tool approvals");
	});
});
