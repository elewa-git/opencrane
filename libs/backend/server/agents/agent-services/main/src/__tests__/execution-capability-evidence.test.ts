import { RevisionBoundaryCoverages, RevisionBoundaryKinds } from "@opencrane/models/agents";
import { describe, expect, it } from "vitest";

import { __ExecutionCapabilityEvidence } from "../execution-capability-evidence";
import type { ExecutionCapabilityEvidenceInput } from "../execution-capability-evidence.types";

/** Builds canonicalization input whose arrays may arrive in arbitrary database order. */
function _Input(): ExecutionCapabilityEvidenceInput
{
	return {
		siloId: "silo-1",
		agentServiceId: "service-1",
		agentRevisionId: "revision-1",
		agentRevisionDigest: `sha256:${"a".repeat(64)}`,
		principalId: "principal-1",
		fleetMembershipRevision: 7,
		fleetMembershipPayloadDigest: `sha256:${"b".repeat(64)}`,
		authorizationDecisionDigests: [`sha256:${"f".repeat(64)}`, `sha256:${"c".repeat(64)}`],
		effectiveBoundaryAttachments: [{ boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "😀", boundaryCoverage: RevisionBoundaryCoverages.Exact }, { boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "\uE000", boundaryCoverage: RevisionBoundaryCoverages.Exact }],
		modelDefinitionId: "model-1",
		budget: { turns: 8 },
		skillAssignments: [{ skillId: "skill-z", skillRevisionId: "revision-z" }, { skillId: "skill-a", skillRevisionId: "revision-a" }],
		mcpToolRevisionIds: ["tool-z", "tool-a"],
	};
}

describe("shared execution capability evidence", function _Suite()
{
	it("sorts raw Unicode code points and produces the same digest for reversed database rows", function _Canonicalizes()
	{
		const input = _Input();
		const forward = __ExecutionCapabilityEvidence(input);
		const reverse = __ExecutionCapabilityEvidence({ ...input, authorizationDecisionDigests: [...input.authorizationDecisionDigests].reverse(), effectiveBoundaryAttachments: [...input.effectiveBoundaryAttachments].reverse(), skillAssignments: [...input.skillAssignments].reverse(), mcpToolRevisionIds: [...input.mcpToolRevisionIds].reverse() });
		expect(forward).toEqual(reverse);
		expect(forward.effectiveBoundaryAttachments.map(attachment => attachment.boundaryId)).toEqual(["\uE000", "😀"]);
		expect(forward.authorizationDecisionDigests).toEqual([`sha256:${"c".repeat(64)}`, `sha256:${"f".repeat(64)}`]);
	});
});
