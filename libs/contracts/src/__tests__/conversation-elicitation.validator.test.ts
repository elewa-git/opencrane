import { describe, expect, it } from "vitest";

import { AGENT_RUNTIME_PROTOCOL_VERSION, RuntimeCandidateKinds } from "../agent-runtime-protocol.types";
import { ElicitationBodyKinds, ElicitationPurposes } from "../conversation-elicitation.types";
import { ___ParseRuntimeElicitationCandidate } from "../conversation-elicitation.validator";

/** One complete runtime-input candidate used to vary trust-boundary fields. */
function _Candidate(): unknown
{
	return {
		protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
		runtimeInstanceId: "runtime-1",
		commandId: "command-1",
		candidateId: "candidate-1",
		runId: "run-1",
		attempt: 1,
		fence: 1,
		kind: RuntimeCandidateKinds.Elicitation,
		proposal: { requestKey: "question-1", purpose: ElicitationPurposes.RuntimeInput, body: { kind: ElicitationBodyKinds.FreeText, prompt: "What should I do next?", maximumLength: 500, allowEmpty: false }, purposePayloadDigest: `sha256:${"a".repeat(64)}`, expiresInSeconds: 300 },
	};
}

describe("runtime elicitation candidate validation", function _DescribeRuntimeElicitationCandidate()
{
	it("accepts one strict bounded runtime-input proposal", function _AcceptsRuntimeInput()
	{
		expect(___ParseRuntimeElicitationCandidate(_Candidate())).toMatchObject({ kind: RuntimeCandidateKinds.Elicitation, proposal: { purpose: ElicitationPurposes.RuntimeInput } });
	});

	it("refuses protected purposes and hidden input payloads", function _RefusesProtectedPurposes()
	{
		const protectedPurpose = structuredClone(_Candidate()) as { proposal: { purpose: ElicitationPurposes } };
		protectedPurpose.proposal.purpose = ElicitationPurposes.ToolApproval;
		const hiddenPayload = structuredClone(_Candidate()) as { proposal: { purposePayload?: unknown } };
		hiddenPayload.proposal.purposePayload = { secret: "never" };

		expect(___ParseRuntimeElicitationCandidate(protectedPurpose)).toBeNull();
		expect(___ParseRuntimeElicitationCandidate(hiddenPayload)).toBeNull();
	});

	it("refuses duplicate choices and response windows outside server bounds", function _RefusesUnboundedProposal()
	{
		const duplicateChoices = structuredClone(_Candidate()) as { proposal: { body: unknown } };
		duplicateChoices.proposal.body = { kind: ElicitationBodyKinds.SingleChoice, prompt: "Choose", choices: [{ value: "same", label: "One" }, { value: "same", label: "Two" }] };
		const excessiveExpiry = structuredClone(_Candidate()) as { proposal: { expiresInSeconds: number } };
		excessiveExpiry.proposal.expiresInSeconds = 901;

		expect(___ParseRuntimeElicitationCandidate(duplicateChoices)).toBeNull();
		expect(___ParseRuntimeElicitationCandidate(excessiveExpiry)).toBeNull();
	});
});
