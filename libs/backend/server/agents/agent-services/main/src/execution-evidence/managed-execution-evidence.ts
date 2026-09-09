import { AgentIdentityStates } from "@opencrane/contracts";
import { __DigestHumanMembershipEvidence, __HumanMembershipRevision } from "@opencrane/backend/server/iam/membership";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import { ExecutionSubjectMembershipKinds } from "@opencrane/models/agents";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import type { JsonValue } from "@opencrane/util";

import type { ManagedExecutionEvidenceRepository } from "../company-assistants/managed-agent.types";
import { ManagedExecutionEvidenceDenialReasons, type ManagedExecutionEvidenceAuthorityPort, type ManagedExecutionEvidenceCommand, type ManagedExecutionEvidenceResult } from "./managed-execution-evidence.types";
import type { PersonalExecutionEvidenceTransaction } from "./personal-execution-evidence.types";

/** Evaluates a company assistant through its own Principal and the requesting human through current human membership. */
export class ManagedExecutionEvidenceAuthority implements ManagedExecutionEvidenceAuthorityPort
{
	/** Shares current service and requester reads with the run-admission transaction. */
	public constructor(private readonly repository: ManagedExecutionEvidenceRepository) {}

	/** Admits human Invoke and company model Use independently before freezing their evidence. */
	public async load(command: ManagedExecutionEvidenceCommand, transaction: PersonalExecutionEvidenceTransaction): Promise<ManagedExecutionEvidenceResult>
	{
		const identity = command.identity;
		if (identity.kind !== "managed" || identity.state !== AgentIdentityStates.Active || identity.principalId === command.requesterPrincipalId)
			return { outcome: "denied", reason: ManagedExecutionEvidenceDenialReasons.IdentityUnavailable };
		const revision = await this.repository.loadCurrent(identity.siloId, identity.agentServiceId);
		if (revision === null || revision.agentRevisionId !== command.agentRevisionId)
			return { outcome: "denied", reason: ManagedExecutionEvidenceDenialReasons.RunNotAdmittable };
		if (revision.principalId !== identity.principalId)
			return { outcome: "denied", reason: ManagedExecutionEvidenceDenialReasons.IdentityUnavailable };
		const duration = typeof revision.budget === "object" && revision.budget !== null && "maxDurationMs" in revision.budget ? revision.budget.maxDurationMs : undefined;
		if (typeof duration !== "number" || !Number.isSafeInteger(duration) || duration <= 0)
			return { outcome: "denied", reason: ManagedExecutionEvidenceDenialReasons.RunNotAdmittable };
		const human = await this.repository.verifyRequesterMembership(identity.siloId, command.requesterPrincipalId, transaction.admittedAtEpochMs);
		if (human === null || human.principalId !== command.requesterPrincipalId)
			return { outcome: "denied", reason: ManagedExecutionEvidenceDenialReasons.MembershipStale };
		const argumentsDigest = __DigestCanonicalJson({ agentIdentityId: identity.id, principalId: identity.principalId, agentServiceId: identity.agentServiceId, agentRevisionId: revision.agentRevisionId, agentRevisionDigest: revision.agentRevisionDigest, membershipDigest: __DigestHumanMembershipEvidence(human) });
		const invocation = await transaction.authorization.admitPrincipal({ siloId: identity.siloId, principalId: command.requesterPrincipalId, actorKind: "user", actorId: command.requesterPrincipalId, resource: { kind: ProductAuthorizationResourceKinds.AgentService, id: identity.agentServiceId }, action: ProductAuthorizationActions.Invoke, argumentsDigest, membershipRevision: __HumanMembershipRevision(human), nowEpochMs: transaction.admittedAtEpochMs });
		if (invocation.outcome !== AuthorizationDecisionOutcomes.Allow || invocation.evidence === null)
			return { outcome: "denied", reason: ManagedExecutionEvidenceDenialReasons.CapabilityUnavailable };
		const model = await transaction.authorization.admitPrincipal({ siloId: identity.siloId, principalId: identity.principalId, actorKind: "agent-service", actorId: identity.principalId, resource: { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: revision.modelDefinitionId }, action: ProductAuthorizationActions.Use, argumentsDigest, nowEpochMs: transaction.admittedAtEpochMs });
		if (model.outcome !== AuthorizationDecisionOutcomes.Allow || model.evidence === null)
			return { outcome: "denied", reason: ManagedExecutionEvidenceDenialReasons.CapabilityUnavailable };
		const requesterMembership = human;
		const membership = { kind: ExecutionSubjectMembershipKinds.Managed as const, principalId: identity.principalId, siloId: identity.siloId, agentServiceId: identity.agentServiceId, agentRevisionId: revision.agentRevisionId, agentRevisionDigest: revision.agentRevisionDigest, decisionEvidenceId: model.evidence.decisionDigest, trustedUntil: new Date(Math.min(transaction.admittedAtEpochMs + duration, Date.parse(human.trustedUntil))).toISOString() };
		const decisions = [invocation.evidence.decisionDigest, model.evidence.decisionDigest].sort();
		const capability = { effectiveBoundaryAttachments: [], effectiveBoundaryAttachmentDigest: __DigestCanonicalJson([]), authorizationDecisionDigests: decisions, effectiveContractDigest: __DigestCanonicalJson({ revision, membership, requesterMembership, authorizationDecisionDigests: decisions } as unknown as JsonValue) };
		return { outcome: "loaded", value: { revision, membership, requesterMembership, capability, admissionDecisionDigest: invocation.evidence.decisionDigest } };
	}
}
