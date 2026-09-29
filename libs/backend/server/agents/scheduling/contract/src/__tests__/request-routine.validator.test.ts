import { ___CompiledFirstPartyToolDefinitionSchema } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";
import { describe, expect, it } from "vitest";

import { REQUEST_ROUTINE_TOOL, ___RequestRoutineSuggestionSchema } from "../index";

const _SCHEDULE = { expression: "0 9 * * 1", timezone: "UTC" };
const _SUGGESTION = { instruction: "  Review the latest report.  ", schedule: _SCHEDULE };

describe("request routine scheduling contract", function _Suite()
{
	it("normalizes the strict model suggestion", function _Suggestion()
	{
		expect(___RequestRoutineSuggestionSchema.parse(_SUGGESTION)).toEqual({ instruction: "Review the latest report.", schedule: _SCHEDULE });
	});

	it.each([
		{ ..._SUGGESTION, requesterPrincipalId: "person-1" },
		{ ..._SUGGESTION, sourceConversationId: "conversation-1" },
		{ ..._SUGGESTION, proposalRef: "proposal-1" },
		{ ..._SUGGESTION, audienceParticipantRefs: ["participant-1"] },
		{ ..._SUGGESTION, schedule: { ..._SCHEDULE, expression: "0 9 * *" } },
	])("rejects identity, audience and malformed schedule fields: %j", function _Rejects(value)
	{
		expect(___RequestRoutineSuggestionSchema.safeParse(value).success).toBe(false);
	});

	it("freezes the provider descriptor as proposal-only and human-review-required", function _Descriptor()
	{
		expect(REQUEST_ROUTINE_TOOL).toMatchObject({ kind: "first_party", name: "request_routine", modelName: "request_routine", capability: "request_routine", capabilityRevision: "opencrane:scheduling:request_routine:v1", effect: "proposal_only", materialization: "human_review_required" });
		expect(REQUEST_ROUTINE_TOOL).not.toHaveProperty("toolRevisionId");
		expect(REQUEST_ROUTINE_TOOL).not.toHaveProperty("requiresApproval");
		expect(REQUEST_ROUTINE_TOOL.parametersSchema).toMatchObject({ type: "object", additionalProperties: false, required: ["instruction", "schedule"] });
		expect(REQUEST_ROUTINE_TOOL.parametersSchemaDigest).toBe(___DigestCanonicalJson(REQUEST_ROUTINE_TOOL.parametersSchema));
		expect(___CompiledFirstPartyToolDefinitionSchema.parse(REQUEST_ROUTINE_TOOL)).toEqual(REQUEST_ROUTINE_TOOL);
	});
});
