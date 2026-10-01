import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import { __DigestHumanMembershipEvidence } from "@opencrane/backend/server/iam/membership";
import type { RevisionBoundaryAttachment } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import type { ExecutionCapabilityEvidence, ExecutionCapabilityEvidenceInput } from "./execution-capability-evidence.types";

/** Derives deterministic execution capability evidence from immutable revision and current authority facts. */
export function __ExecutionCapabilityEvidence(input: ExecutionCapabilityEvidenceInput): ExecutionCapabilityEvidence
{
	const attachments = _CanonicalAttachments(input.effectiveBoundaryAttachments);
	const authorizationDecisionDigests = [...input.authorizationDecisionDigests].sort(_CompareCanonicalCoordinate);
	const effectiveBoundaryAttachmentDigest = __DigestCanonicalJson(attachments as unknown as JsonValue);
	const effectiveContractDigest = __DigestCanonicalJson({
		siloId: input.siloId,
		agentServiceId: input.agentServiceId,
		agentRevisionId: input.agentRevisionId,
		agentRevisionDigest: input.agentRevisionDigest,
		principalId: input.principalId,
		membershipDigest: __DigestHumanMembershipEvidence(input.membership),
		authorizationDecisionDigests,
		effectiveBoundaryAttachments: attachments,
		modelDefinitionId: input.modelDefinitionId,
		budget: input.budget,
		skillAssignments: [...input.skillAssignments].sort(function _BySkill(left, right): number { return _CompareCanonicalCoordinate(`${left.skillId}\u0000${left.skillRevisionId}`, `${right.skillId}\u0000${right.skillRevisionId}`); }),
		mcpToolRevisionIds: [...input.mcpToolRevisionIds].sort(_CompareCanonicalCoordinate),
	} as unknown as JsonValue);
	return { effectiveContractDigest, effectiveBoundaryAttachments: attachments, effectiveBoundaryAttachmentDigest, authorizationDecisionDigests };
}

/** Compares canonical coordinates by raw Unicode code points without locale-dependent collation. */
function _CompareCanonicalCoordinate(left: string, right: string): number
{
	const leftCodePoints = Array.from(left, function _CodePoint(value): number { return value.codePointAt(0)!; });
	const rightCodePoints = Array.from(right, function _CodePoint(value): number { return value.codePointAt(0)!; });
	const length = Math.min(leftCodePoints.length, rightCodePoints.length);
	for (let index = 0; index < length; index += 1)
	{
		if (leftCodePoints[index]! < rightCodePoints[index]!)
			return -1;
		if (leftCodePoints[index]! > rightCodePoints[index]!)
			return 1;
	}
	if (leftCodePoints.length < rightCodePoints.length)
		return -1;
	if (leftCodePoints.length > rightCodePoints.length)
		return 1;
	return 0;
}

/** Sorts effective boundaries by stable kind, identifier, and coverage coordinates. */
function _CanonicalAttachments(values: readonly RevisionBoundaryAttachment[]): readonly RevisionBoundaryAttachment[]
{
	return [...values].sort(function _ByBoundary(left, right): number
	{
		return _CompareCanonicalCoordinate(`${left.boundaryKind}\u0000${left.boundaryId}\u0000${left.boundaryCoverage}`, `${right.boundaryKind}\u0000${right.boundaryId}\u0000${right.boundaryCoverage}`);
	});
}
