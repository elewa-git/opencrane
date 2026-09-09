import { ExternalActionRecoveryModes, type ToolInvocationAuthorizationCoordinate, type ToolInvocationAuthorizationEvidence, type ToolInvocationIntent } from "@opencrane/backend/server/iam/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { FrozenConversationComputerTurn } from "../../../conversation-computer-turn.types";
import type { PreparedConversationToolProposal } from "../../../conversation-tool-proposal.types";
import type { ConversationToolProposalRun } from "./conversation-tool-proposal-run.types";

/**
 * Builds the invocation from the saved run, validated proposal and successful permission decision.
 *
 * Observation time and new decision digests stay outside the request fingerprint, so retrying the
 * same proposal can recover its original invocation. The evidence digest still binds that decision
 * to this run, attempt, revision and argument body.
 */
export function _CreateConversationToolProposalIntent(turn: FrozenConversationComputerTurn, run: ConversationToolProposalRun, proposal: PreparedConversationToolProposal, coordinate: ToolInvocationAuthorizationCoordinate, decisionDigest: `sha256:${string}`): ToolInvocationIntent
{
	const binding = {
		actorKind: "workload" as const,
		executionSubject: run.subject,
		coordinates: [coordinate],
		decisionDigests: [decisionDigest],
		assignmentDigest: proposal.assignmentDigest,
	};
	const evidenceBody = {
		...binding,
		agentRevisionId: run.agentRevisionId,
		runId: turn.compile.runId,
		attempt: turn.compile.attempt,
		argumentsDigest: proposal.argumentsDigest,
	};
	const authorizationEvidence: ToolInvocationAuthorizationEvidence = {
		...binding,
		evidenceDigest: ___DigestCanonicalJson(evidenceBody as unknown as JsonValue),
	};
	return {
		siloId: turn.siloId,
		runId: turn.compile.runId,
		attempt: turn.compile.attempt,
		agentServiceId: turn.binding.agentServiceId,
		agentRevisionId: run.agentRevisionId,
		authorizationEvidence,
		requestIdentity: {
			runtimeInstanceId: turn.computerId,
			commandId: turn.bootstrapId,
			candidateId: proposal.proposalId,
		},
		toolRevisionId: proposal.tool.toolRevisionId,
		toolInvocationId: proposal.proposalId,
		arguments: proposal.arguments,
		argumentsDigest: proposal.argumentsDigest,
		requestFingerprint: proposal.requestFingerprint,
		approvalRequired: false,
		recoveryMode: ExternalActionRecoveryModes.Manual,
		recoveryKey: null,
	};
}
