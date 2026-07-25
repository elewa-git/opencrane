import { describe, expect, it } from "vitest";

import { __AuthorizeGovernedChildRunSpawn } from "../child-run-admission.js";
import type { GovernedChildRunCapabilityDelegation, GovernedChildRunParent, GovernedChildRunSpawnRequest } from "../child-run-admission.types.js";

const _PARENT_CAPABILITY_DIGEST = `sha256:${"a".repeat(64)}`;
const _CHILD_CAPABILITY_DIGEST = `sha256:${"b".repeat(64)}`;

/** Builds a parent whose immutable snapshot deliberately exposes several selectable inputs. */
function _Parent(overrides: Partial<GovernedChildRunParent> = {}): GovernedChildRunParent
{
	return {
		runId: "parent-run",
		rootRunId: "root-run",
		siloId: "silo-a",
		snapshot: {
			runId: "parent-run", siloId: "silo-a", agentServiceId: "parent-service", agentRevisionId: "parent-revision", snapshotVersion: 1,
			threadId: "thread-1", messageIds: ["message-1", "message-2"], personaRevisionId: "persona-1", preferenceFactIds: [], artifactRevisionIds: ["artifact-1"], skillRevisionIds: ["skill-1"],
			memoryFacts: [{ datasetId: "dataset-1", factId: "fact-1", contentDigest: `sha256:${"c".repeat(64)}`, provenance: [] }], memoryQueryPolicy: {}, integrationAssignments: [], modelRoute: {}, budgetPolicy: {},
			identitySnapshot: { executionSubjectId: "user-1", fleetMembershipRevision: 1, fleetMembershipIssuer: "issuer", fleetMembershipIssuerKeyId: "key", fleetMembershipAssertionId: "assertion", fleetMembershipPayloadDigest: `sha256:${"d".repeat(64)}`, fleetMembershipTrustedUntil: "2026-07-26T00:00:00.000Z" },
			capabilitySetDigest: _PARENT_CAPABILITY_DIGEST, effectiveContractDigest: `sha256:${"e".repeat(64)}`, promptCompilerVersion: "test-v1", digest: `sha256:${"f".repeat(64)}`, compiledAt: "2026-07-25T00:00:00.000Z",
		},
		depth: 0,
		remainingBudget: { maxModelTurns: 4, maxTotalTokens: 400, maxCostUsdMicros: 4000000, maxDurationMs: 60000 },
		...overrides,
	};
}

/** Builds one valid untrusted candidate request. */
function _Request(overrides: Partial<GovernedChildRunSpawnRequest> = {}): GovernedChildRunSpawnRequest
{
	return {
		siloId: "silo-a",
		agentServiceId: "child-service",
		capabilitySetDigest: _CHILD_CAPABILITY_DIGEST,
		context: { messageIds: ["message-1"], memoryFactIds: ["fact-1"], artifactRevisionIds: ["artifact-1"], skillRevisionIds: ["skill-1"] },
		budget: { maxModelTurns: 2, maxTotalTokens: 200, maxCostUsdMicros: 2000000, maxDurationMs: 30000 },
		task: { prompt: "Summarise the selected evidence." },
		...overrides,
	};
}

/** Proves only the expected service and child digest narrow the selected parent capability set. */
const _Delegation: GovernedChildRunCapabilityDelegation = {
	allows(parentCapabilitySetDigest, childAgentServiceId, childCapabilitySetDigest): boolean
	{
		return parentCapabilitySetDigest === _PARENT_CAPABILITY_DIGEST && childAgentServiceId === "child-service" && childCapabilitySetDigest === _CHILD_CAPABILITY_DIGEST;
	},
};

describe("__AuthorizeGovernedChildRunSpawn", function _DescribeChildAdmission()
{
	it("derives a detached child authorization from locked parent authority", function _Authorize()
	{
		const request = _Request();
		const result = __AuthorizeGovernedChildRunSpawn(_Parent(), request, 1, { maximumDepth: 2, maximumChildrenPerParent: 3 }, _Delegation);

		expect(result).toEqual({
			outcome: "authorized",
			authorization: {
				siloId: "silo-a", rootRunId: "root-run", parentRunId: "parent-run", depth: 1,
				capabilitySetDigest: _CHILD_CAPABILITY_DIGEST, agentServiceId: "child-service",
				context: request.context, budget: request.budget, task: request.task,
			},
		});

		if (result.outcome !== "authorized") throw new Error("Expected an authorization.");
		(request.context.messageIds as string[])[0] = "message-2";
		(request.task as { prompt: string }).prompt = "Mutated after authorization.";
		expect(result.authorization.context.messageIds).toEqual(["message-1"]);
		expect(result.authorization.task).toEqual({ prompt: "Summarise the selected evidence." });
	});

	it("rejects context not already and uniquely frozen in the parent snapshot", function _RejectContext()
	{
		const sibling = __AuthorizeGovernedChildRunSpawn(_Parent(), _Request({ context: { messageIds: ["sibling-message"], memoryFactIds: [], artifactRevisionIds: [], skillRevisionIds: [] } }), 0, { maximumDepth: 2, maximumChildrenPerParent: 3 }, _Delegation);
		const duplicate = __AuthorizeGovernedChildRunSpawn(_Parent(), _Request({ context: { messageIds: ["message-1", "message-1"], memoryFactIds: [], artifactRevisionIds: [], skillRevisionIds: [] } }), 0, { maximumDepth: 2, maximumChildrenPerParent: 3 }, _Delegation);

		expect(sibling).toEqual({ outcome: "denied", reason: "context_not_parent_readable" });
		expect(duplicate).toEqual({ outcome: "denied", reason: "context_not_parent_readable" });
	});

	it("rejects cross-silo, over-depth, fan-out, capability, and budget expansion", function _RejectEscalation()
	{
		const policy = { maximumDepth: 1, maximumChildrenPerParent: 1 };

		expect(__AuthorizeGovernedChildRunSpawn(_Parent(), _Request({ siloId: "silo-b" }), 0, policy, _Delegation)).toEqual({ outcome: "denied", reason: "cross_silo" });
		expect(__AuthorizeGovernedChildRunSpawn(_Parent({ depth: 1 }), _Request(), 0, policy, _Delegation)).toEqual({ outcome: "denied", reason: "depth_exceeded" });
		expect(__AuthorizeGovernedChildRunSpawn(_Parent(), _Request(), 1, policy, _Delegation)).toEqual({ outcome: "denied", reason: "fanout_exceeded" });
		expect(__AuthorizeGovernedChildRunSpawn(_Parent(), _Request(), 0, policy, { allows: function _Deny(): boolean { return false; } })).toEqual({ outcome: "denied", reason: "capability_escalation" });
		expect(__AuthorizeGovernedChildRunSpawn(_Parent(), _Request({ budget: { maxModelTurns: 5, maxTotalTokens: 200, maxCostUsdMicros: 2000000, maxDurationMs: 30000 } }), 0, policy, _Delegation)).toEqual({ outcome: "denied", reason: "budget_exceeded" });
		expect(__AuthorizeGovernedChildRunSpawn(_Parent(), _Request({ budget: { maxModelTurns: 2, maxTotalTokens: 200, maxCostUsdMicros: 4000001, maxDurationMs: 30000 } }), 0, policy, _Delegation)).toEqual({ outcome: "denied", reason: "budget_exceeded" });
	});

	it("fails closed on malformed candidate data before it reaches the capability verifier", function _RejectMalformed()
	{
		const malformed = { ..._Request(), capabilitySetDigest: "not-a-digest", task: undefined } as unknown as GovernedChildRunSpawnRequest;
		const result = __AuthorizeGovernedChildRunSpawn(_Parent(), malformed, 0, { maximumDepth: 2, maximumChildrenPerParent: 3 }, _Delegation);

		expect(result).toEqual({ outcome: "denied", reason: "invalid_request" });
	});
});
