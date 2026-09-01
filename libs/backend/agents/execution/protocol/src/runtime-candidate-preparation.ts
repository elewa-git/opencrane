import { createHash } from "node:crypto";

import type { RuntimeElicitationUnitOfWork } from "@opencrane/backend/agents/execution/elicitation";
import { ExternalActionRecoveryModes, __DigestCanonicalJson, __ValidateDeferredToolArguments, type ToolInvocationIntent } from "@opencrane/backend/server/iam/authorization";
import { ElicitationPurposes, type RuntimeElicitationCandidate, type RuntimeExternalActionCandidate } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import { _CompileRunInputForContext } from "./compiled-run-input-context";
import type { RunInputCompiler, RuntimeDispatchContext } from "./prisma-runtime-dispatch-authority.types";
import type { RuntimeExternalActionAuthorizationEvidence } from "./runtime-external-action-authorization.types";
import type { RuntimeToolInvocationPreparation } from "./runtime-candidate-preparation.types";

/** Bind one generic runtime proposal to transaction-consistent run, conversation, participant, and server time. */
export async function _OpenRuntimeElicitation(context: RuntimeDispatchContext, candidate: RuntimeElicitationCandidate, elicitationUnitOfWork: RuntimeElicitationUnitOfWork, now: Date): Promise<boolean>
{
	if (context.conversationId === null)
		return false;
	if (candidate.proposal.purpose !== ElicitationPurposes.RuntimeInput && candidate.proposal.purpose !== ElicitationPurposes.A2uiAction)
		return false;
	const purposePayload = candidate.proposal.purposePayload;
	const expectedPayloadDigest = __DigestCanonicalJson(purposePayload === undefined ? null : purposePayload);
	if (candidate.proposal.purposePayloadDigest !== expectedPayloadDigest)
		return false;
	const expiresAt = new Date(Math.min(now.getTime() + candidate.proposal.expiresInSeconds * 1_000, context.leaseExpiresAtEpochMs));
	if (expiresAt.getTime() <= now.getTime())
		return false;
	const fingerprint = __DigestCanonicalJson({ protocolVersion: candidate.protocolVersion, runtimeInstanceId: candidate.runtimeInstanceId, commandId: candidate.commandId, candidateId: candidate.candidateId, runId: context.runId, attempt: context.attempt, fence: candidate.fence, proposal: candidate.proposal } as unknown as JsonValue);
	const opened = await elicitationUnitOfWork.open({
		requestId: `elicitation-${fingerprint.slice("sha256:".length)}`,
		siloId: context.siloId,
		conversationId: context.conversationId,
		runId: context.runId,
		attempt: context.attempt,
		assignedParticipantId: context.executionSubject.principalId,
		requestKey: candidate.proposal.requestKey,
		purpose: candidate.proposal.purpose,
		body: candidate.proposal.body,
		purposePayload,
		purposePayloadDigest: expectedPayloadDigest,
		requiresStepUp: false,
		now,
		expiresAt,
	});
	return opened !== null;
}

/** Compile and validate provider-free invocation facts before recording an allow decision. */
export async function _PrepareToolInvocation(transaction: Parameters<RunInputCompiler>[2], context: RuntimeDispatchContext, runtimeInstanceId: string, candidate: RuntimeExternalActionCandidate, compileRunInput: RunInputCompiler): Promise<RuntimeToolInvocationPreparation | null>
{
	const actualArgumentsDigest = __DigestCanonicalJson(candidate.arguments);
	if (actualArgumentsDigest !== candidate.argumentsDigest)
		return null;
	const compiled = await _CompileRunInputForContext(context, transaction, compileRunInput);
	const tool = compiled.tools.find(function _Granted(definition) { return definition.toolRevisionId === candidate.toolRevisionId; });
	if (tool === undefined || __DigestCanonicalJson(tool.parametersSchema) !== tool.parametersSchemaDigest || !__ValidateDeferredToolArguments(tool.parametersSchema, candidate.arguments))
		return null;
	return {
		siloId: context.siloId,
		runId: context.runId,
		attempt: context.attempt,
		agentServiceId: context.agentServiceId,
		agentRevisionId: context.agentRevisionId,
		requestIdentity: { runtimeInstanceId, commandId: candidate.commandId, candidateId: candidate.candidateId },
		toolRevisionId: candidate.toolRevisionId,
		toolInvocationId: candidate.toolInvocationId,
		arguments: candidate.arguments,
		argumentsDigest: candidate.argumentsDigest,
		requestFingerprint: _RuntimeToolInvocationFingerprint(candidate, actualArgumentsDigest),
		approvalRequired: tool.requiresApproval || candidate.toolRevisionId === PERSONAL_MEMORY_RECALL_TOOL_REVISION,
		recoveryMode: ExternalActionRecoveryModes.Manual,
		recoveryKey: null,
	};
}

/** Bind central evidence only after the invocation is fully compiled and schema-valid. */
export function _BindToolInvocationAuthorization(preparation: RuntimeToolInvocationPreparation, context: RuntimeDispatchContext, authorizationEvidence: RuntimeExternalActionAuthorizationEvidence): ToolInvocationIntent | null
{
	if (authorizationEvidence.agentRevisionId !== context.agentRevisionId
		|| authorizationEvidence.runId !== context.runId
		|| authorizationEvidence.attempt !== context.attempt
		|| authorizationEvidence.argumentsDigest !== preparation.argumentsDigest
		|| authorizationEvidence.assignmentDigest !== context.assignmentDigest)
		return null;
	return {
		...preparation,
		authorizationEvidence: {
			actorKind: authorizationEvidence.actorKind,
			executionSubject: authorizationEvidence.executionSubject,
			coordinates: authorizationEvidence.coordinates,
			decisionDigests: authorizationEvidence.decisionDigests,
			assignmentDigest: authorizationEvidence.assignmentDigest,
			evidenceDigest: authorizationEvidence.evidenceDigest,
		},
	};
}

/**
 * Hash the invocation together with its canonical arguments, so a replay must carry the same arguments.
 *
 * Called by: candidate preparation and idempotent replay validation in the runtime dispatcher.
 */
export function _RuntimeToolInvocationFingerprint(candidate: RuntimeExternalActionCandidate, argumentsDigest: string): string
{
	const canonical = JSON.stringify(["opencrane-tool-invocation-fingerprint-v1", candidate.runId, candidate.attempt, candidate.toolRevisionId, candidate.toolInvocationId, argumentsDigest]);
	return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}
