import type { RunInputSnapshot } from "@opencrane/contracts";
import { describe, expect, it } from "vitest";

import { __AuthorizeGovernedChildRunSpawn } from "../child-run-admission.js";
import type { GovernedChildRunParent, GovernedChildRunPolicy, GovernedChildRunSpawnRequest } from "../child-run-admission.types.js";

/** Creates the immutable parent snapshot used to constrain every child selection. */
function _snapshot(): RunInputSnapshot
{
	return {
		runId: "parent-run", siloId: "silo-a", agentServiceId: "parent-service", agentRevisionId: "parent-revision", snapshotVersion: 1, threadId: "thread-1", messageIds: ["message-1", "message-2"], personaRevisionId: "persona-1", preferenceFactIds: [], artifactRevisionIds: ["artifact-1"], skillRevisionIds: ["skill-1"], memoryFacts: [{ datasetId: "dataset-1", factId: "fact-1", contentDigest: "sha256:fact", provenance: [] }], memoryQueryPolicy: {}, integrationAssignments: [], modelRoute: {}, budgetPolicy: {}, identitySnapshot: { executionSubjectId: "user-1", fleetMembershipRevision: 1, fleetMembershipIssuer: "issuer-1", fleetMembershipIssuerKeyId: "key-1", fleetMembershipAssertionId: "assertion-1", fleetMembershipPayloadDigest: "sha256:membership", fleetMembershipTrustedUntil: "2026-07-25T00:00:00.000Z" }, capabilitySetDigest: "sha256:parent-capabilities", effectiveContractDigest: "sha256:contract", promptCompilerVersion: "v1", digest: "sha256:parent-snapshot", compiledAt: "2026-07-24T00:00:00.000Z",
	};
}

/** Creates a valid parent with enough remaining budget for a bounded child. */
function _parent(): GovernedChildRunParent
{
	return { runId: "parent-run", rootRunId: "root-run", siloId: "silo-a", snapshot: _snapshot(), depth: 1, remainingBudget: { maxTotalTokens: 100, maxCostUsdMicros: 500, maxToolInvocations: 3 } };
}

/** Creates one legal same-silo child proposal. */
function _request(): GovernedChildRunSpawnRequest
{
	return { siloId: "silo-a", agentServiceId: "child-service", capabilitySetDigest: "sha256:child-capabilities", context: { messageIds: ["message-1"], memoryFactIds: ["fact-1"], artifactRevisionIds: ["artifact-1"], skillRevisionIds: ["skill-1"] }, budget: { maxTotalTokens: 50, maxCostUsdMicros: 200, maxToolInvocations: 1 }, task: { task: "summarize" } };
}

/** Returns the bounded policy used by all child-run admission tests. */
function _policy(): GovernedChildRunPolicy
{
	return { maximumDepth: 3, maximumChildrenPerParent: 2 };
}

/** Capability authority allowing exactly the reviewed child digest. */
const _delegation = { allows: function _allows(parentDigest: string, childAgentServiceId: string, childDigest: string): boolean { return parentDigest === "sha256:parent-capabilities" && childAgentServiceId === "child-service" && childDigest === "sha256:child-capabilities"; } };

describe("governed child-run admission", function _describeGovernedChildRunAdmission()
{
	it("inherits lineage and permits only the parent-selected context subset", function _admitsBoundedChild()
	{
		expect(__AuthorizeGovernedChildRunSpawn(_parent(), _request(), 0, _policy(), _delegation)).toEqual({ outcome: "authorized", authorization: { siloId: "silo-a", rootRunId: "root-run", parentRunId: "parent-run", depth: 2, context: _request().context, budget: _request().budget, agentServiceId: "child-service", capabilitySetDigest: "sha256:child-capabilities", task: { task: "summarize" } } });
	});

	it("rejects a sibling's unbrokered message even when it names the same thread", function _rejectsSiblingContext()
	{
		const request = { ..._request(), context: { ..._request().context, messageIds: ["message-1", "sibling-message"] } };
		expect(__AuthorizeGovernedChildRunSpawn(_parent(), request, 0, _policy(), _delegation)).toEqual({ outcome: "denied", reason: "context_not_parent_readable" });
	});

	it("rejects capability escalation, depth overflow, fan-out overflow, and budget overdraw before persistence", function _rejectsUnsafeChild()
	{
		expect(__AuthorizeGovernedChildRunSpawn(_parent(), { ..._request(), capabilitySetDigest: "sha256:escalated" }, 0, _policy(), _delegation)).toEqual({ outcome: "denied", reason: "capability_escalation" });
		expect(__AuthorizeGovernedChildRunSpawn(_parent(), { ..._request(), agentServiceId: "swapped-service" }, 0, _policy(), _delegation)).toEqual({ outcome: "denied", reason: "capability_escalation" });
		expect(__AuthorizeGovernedChildRunSpawn({ ..._parent(), depth: 3 }, _request(), 0, _policy(), _delegation)).toEqual({ outcome: "denied", reason: "depth_exceeded" });
		expect(__AuthorizeGovernedChildRunSpawn(_parent(), _request(), 2, _policy(), _delegation)).toEqual({ outcome: "denied", reason: "fanout_exceeded" });
		expect(__AuthorizeGovernedChildRunSpawn(_parent(), { ..._request(), budget: { maxTotalTokens: 101, maxCostUsdMicros: 200, maxToolInvocations: 1 } }, 0, _policy(), _delegation)).toEqual({ outcome: "denied", reason: "budget_exceeded" });
	});

	it("rejects a child in another silo", function _rejectsCrossSiloChild()
	{
		expect(__AuthorizeGovernedChildRunSpawn(_parent(), { ..._request(), siloId: "silo-b" }, 0, _policy(), _delegation)).toEqual({ outcome: "denied", reason: "cross_silo" });
		expect(__AuthorizeGovernedChildRunSpawn({ ..._parent(), snapshot: { ..._snapshot(), runId: "different-run" } }, _request(), 0, _policy(), _delegation)).toEqual({ outcome: "denied", reason: "invalid_request" });
		expect(__AuthorizeGovernedChildRunSpawn({ ..._parent(), snapshot: { ..._snapshot(), siloId: "silo-b" } }, _request(), 0, _policy(), _delegation)).toEqual({ outcome: "denied", reason: "invalid_request" });
	});

	it("detaches the returned authorization from caller-owned request objects", function _detachesCallerRequest()
	{
		const request = _request();
		const result = __AuthorizeGovernedChildRunSpawn(_parent(), request, 0, _policy(), _delegation);
		(request.context.messageIds as string[]).push("message-2");
		(request.budget as { maxTotalTokens: number }).maxTotalTokens = 99;
		(request.task as { task: string }).task = "unsafe";

		expect(result).toEqual({ outcome: "authorized", authorization: { siloId: "silo-a", rootRunId: "root-run", parentRunId: "parent-run", depth: 2, context: _request().context, budget: _request().budget, agentServiceId: "child-service", capabilitySetDigest: "sha256:child-capabilities", task: { task: "summarize" } } });
	});

	it("fails closed instead of throwing on malformed boundary input", function _deniesMalformedInput()
	{
		const malformed = { ..._request(), context: { messageIds: "not-an-array", memoryFactIds: [], artifactRevisionIds: [], skillRevisionIds: [] } } as unknown as GovernedChildRunSpawnRequest;
		expect(__AuthorizeGovernedChildRunSpawn(_parent(), malformed, 0, _policy(), _delegation)).toEqual({ outcome: "denied", reason: "invalid_request" });
	});
});
