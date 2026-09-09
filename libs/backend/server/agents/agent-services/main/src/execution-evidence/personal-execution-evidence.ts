import { AgentIdentityStates } from "@opencrane/contracts";
import { __DigestHumanMembershipEvidence, __HumanMembershipRevision } from "@opencrane/backend/server/iam/membership";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import { RevisionBoundaryCoverages, RevisionBoundaryKinds, type RevisionBoundaryAttachment } from "@opencrane/models/agents";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds, type AuthorizationBoundary } from "@opencrane/models/authorization";
import type { JsonValue } from "@opencrane/util";

import { __ExecutionCapabilityEvidence } from "./execution-capability-evidence";
import { PersonalExecutionEvidenceDenialReasons, type PersonalExecutionEvidenceAuthorityPort, type PersonalExecutionEvidenceCommand, type PersonalExecutionEvidenceRepository, type PersonalExecutionEvidenceResult, type PersonalExecutionEvidenceTransaction } from "./personal-execution-evidence.types";

/** Evaluates personal execution authority over one narrow transaction-bound evidence repository. */
export class PersonalExecutionEvidenceAuthority implements PersonalExecutionEvidenceAuthorityPort
{
	/** Binds domain evaluation to the repository created for the run-admission transaction. */
	constructor(private readonly repository: PersonalExecutionEvidenceRepository) {}

	/** Rechecks identity, service, membership, Invoke, and every declared boundary. */
	async load(command: PersonalExecutionEvidenceCommand, transaction: PersonalExecutionEvidenceTransaction): Promise<PersonalExecutionEvidenceResult>
	{
		const identity = command.identity;
		// 1. Require the independently checked Kurrent identity head to realize the requester exactly.
		if (identity.state !== AgentIdentityStates.Active || identity.proxiedPrincipalId !== command.requesterPrincipalId)
			return { outcome: "denied", reason: PersonalExecutionEvidenceDenialReasons.IdentityUnavailable };

		// 2. Re-read the exact active personal service and its published revision through the bound repository.
		const revision = await this.repository.loadActiveRevision(identity.siloId, identity.agentServiceId, command.agentRevisionId);
		if (revision === null)
			return { outcome: "denied", reason: PersonalExecutionEvidenceDenialReasons.RunNotAdmittable };

		// 3. Verify current deployment-selected human membership for the proxied Principal.
		const membership = await this.repository.verifyCurrentMembership(identity.siloId, command.requesterPrincipalId, transaction.admittedAtEpochMs);
		if (membership === null)
			return { outcome: "denied", reason: PersonalExecutionEvidenceDenialReasons.MembershipStale };

		// 4. Admit Invoke centrally and then require an explicit current decision for every revision boundary.
		const declared = revision.boundaryAttachments;
		const argumentsDigest = __DigestCanonicalJson({ agentIdentityId: identity.id, agentServiceId: identity.agentServiceId, agentRevisionId: revision.id, delegationPolicyId: identity.delegationPolicyId, boundaryAttachments: declared, membershipDigest: __DigestHumanMembershipEvidence(membership) } as unknown as JsonValue);
		const invocation = await transaction.authorization.admitPrincipal({ siloId: identity.siloId, principalId: command.requesterPrincipalId, actorKind: "user", actorId: command.requesterPrincipalId, resource: { kind: ProductAuthorizationResourceKinds.AgentService, id: identity.agentServiceId }, action: ProductAuthorizationActions.Invoke, argumentsDigest, membershipRevision: __HumanMembershipRevision(membership), nowEpochMs: transaction.admittedAtEpochMs });
		if (invocation.outcome !== AuthorizationDecisionOutcomes.Allow || invocation.evidence === null)
			return { outcome: "denied", reason: PersonalExecutionEvidenceDenialReasons.CapabilityUnavailable };
		const boundaryAdmissions = [];
		for (const attachment of declared)
		{
			boundaryAdmissions.push(await transaction.authorization.admit({ siloId: identity.siloId, principalId: command.requesterPrincipalId, actorKind: "user", actorId: command.requesterPrincipalId, boundary: _AuthorizationBoundary(attachment), requiredBoundaryCoverage: attachment.boundaryCoverage === RevisionBoundaryCoverages.Descendants ? AuthorizationBoundaryCoverages.Descendants : AuthorizationBoundaryCoverages.Exact, resource: { kind: ProductAuthorizationResourceKinds.AgentService, id: identity.agentServiceId }, action: ProductAuthorizationActions.Invoke, argumentsDigest, membershipRevision: __HumanMembershipRevision(membership), nowEpochMs: transaction.admittedAtEpochMs }));
		}
		if (boundaryAdmissions.some(function _Denied(admission): boolean { return admission.outcome !== AuthorizationDecisionOutcomes.Allow || admission.evidence === null; }))
			return { outcome: "denied", reason: PersonalExecutionEvidenceDenialReasons.CapabilityUnavailable };

		// 5. Canonicalize immutable inputs and durable decisions for execution-subject binding.
		const authorizationDecisionDigests = [invocation.evidence.decisionDigest, ...boundaryAdmissions.map(function _DecisionDigest(admission): string { return admission.evidence!.decisionDigest; })];
		const capability = __ExecutionCapabilityEvidence({ siloId: identity.siloId, agentServiceId: identity.agentServiceId, agentRevisionId: revision.id, agentRevisionDigest: revision.digest, principalId: command.requesterPrincipalId, membership, authorizationDecisionDigests, effectiveBoundaryAttachments: declared, modelDefinitionId: revision.modelDefinitionId, budget: revision.budget, skillAssignments: revision.skillAssignments, mcpToolRevisionIds: revision.mcpToolRevisionIds });
		return { outcome: "loaded", value: { identity: { siloId: identity.siloId, agentIdentityId: identity.id, agentServiceId: identity.agentServiceId, agentRevisionId: revision.id, principalId: command.requesterPrincipalId, delegationPolicyId: identity.delegationPolicyId }, membership, capability, admissionDecisionDigest: invocation.evidence.decisionDigest } };
	}
}

/** Converts one revision attachment into the central authorization boundary vocabulary. */
function _AuthorizationBoundary(attachment: RevisionBoundaryAttachment): AuthorizationBoundary
{
	return attachment.boundaryKind === RevisionBoundaryKinds.Group
		? { kind: AuthorizationBoundaryKinds.Group, groupId: attachment.boundaryId }
		: { kind: AuthorizationBoundaryKinds.Personal, principalId: attachment.boundaryId };
}
