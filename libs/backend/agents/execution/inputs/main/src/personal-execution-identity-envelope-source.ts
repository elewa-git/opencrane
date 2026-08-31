import type { Prisma } from "@prisma/client";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import { __VerifyCurrentFleetMembershipEvidence, FleetMembershipEvidenceOutcomes, PrismaFleetMembershipAuthorityRepository, type FleetMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { RunInputSnapshotIdentityKinds } from "@opencrane/contracts";
import { AgentServiceKinds } from "@opencrane/models/agents";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { IdentityEnvelopeInput, IdentityEnvelopeSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types";
import { PrismaPersonalExecutionIdentityAuthorityRepository } from "./prisma-personal-execution-identity-authority-repository";

/**
 * Verifies the one signed personal-scope assertion for a browser session, inside the admission
 * transaction.
 *
 * All the request supplies is the subject (from the session) and the silo (from the host), both
 * through the assembly command. Everything else — assertion, organisation, scope, capability digest
 * — this source reads from the database inside the transaction. A browser request body never
 * becomes identity evidence.
 */
export class PersonalExecutionIdentityEnvelopeSource implements IdentityEnvelopeSource
{
	/** Fleet-membership trust settings, including the mounted signing key, set once by app composition. */
	private readonly config: FleetMembershipEvidenceConfig;

	/**
	 * Creates the source over the one mounted fleet-membership verifier.
	 *
	 * Validates the configuration at construction rather than per request, so a deployment with a
	 * missing issuer or a nonsensical staleness bound fails at startup instead of admitting runs
	 * against unverifiable membership.
	 *
	 * @param config - Trusted issuer, verifier, and the maximum age a signature may have.
	 * @throws When `trustedIssuerId` is blank, or `maximumStalenessMs` is not a positive safe integer.
	 */
	constructor(config: FleetMembershipEvidenceConfig)
	{
		if (config.trustedIssuerId.trim().length === 0 || !Number.isSafeInteger(config.maximumStalenessMs) || config.maximumStalenessMs <= 0)
		{
			throw new Error("personal execution identity requires a trusted issuer and positive staleness bound");
		}
		this.config = config;
	}

	/**
	 * Verifies one personal assertion and returns the signed identity evidence.
	 *
	 * Refuses when more than one assertion matches rather than picking one: an ambiguous entitlement
	 * means the organisation the run would act for is unclear, and guessing it could cross an
	 * organisation boundary.
	 *
	 * @param command - The admission command. Only `siloId` (from the request host) and
	 * `executionSubjectId` (from the session) are used; nothing from a request body.
	 * @param run - Facts from the run authority. Must be a personal run whose `delegatedUserId`
	 * equals the command's subject.
	 * @param transaction - The admission transaction; the signature check, the re-read, and the grant
	 * read all go through it.
	 * @returns `loaded` with the user identity and a digest over its effective grants. `denied` with
	 * `identity_unavailable` when the run is not a personal run for this subject, or `membership_stale`
	 * when no single assertion was found, verification failed, or the re-read did not match what was
	 * verified.
	 */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<IdentityEnvelopeInput>>
	{
		const prisma = transaction.prisma as Prisma.TransactionClient;
		// 1. Reject a managed service before reading any personal membership or dataset row.
		if (command.identityKind !== "user" || run.agentKind !== AgentServiceKinds.Personal || run.delegatedUserId !== command.executionSubjectId)
		{
			return { outcome: "denied", reason: "identity_unavailable" };
		}

		// 2. Resolve the stable local Principal and one current signed silo-membership assertion.
		const identityAuthority = new PrismaPersonalExecutionIdentityAuthorityRepository(prisma);
		const principalId = await identityAuthority.resolvePrincipalId(command.siloId, command.executionIssuer, command.executionSubjectId);
		if (principalId === null)
			return { outcome: "denied", reason: "identity_unavailable" };
		const assertion = await identityAuthority.loadLatestPersonalAssertion(this.config.trustedIssuerId, command.siloId, command.executionSubjectId);
		if (assertion === null)
			return { outcome: "denied", reason: "membership_stale" };

		// 3. Check the signature, freshness, and monotonic revision high-watermark in this transaction.
		const membership = await __VerifyCurrentFleetMembershipEvidence(new PrismaFleetMembershipAuthorityRepository(prisma), this.config.verifier, {
			trustedIssuerId: this.config.trustedIssuerId,
			siloId: command.siloId,
			subjectId: command.executionSubjectId,
			assertionId: assertion.assertionId,
			nowEpochMs: transaction.admittedAtEpochMs,
			maximumStalenessMs: this.config.maximumStalenessMs,
		});
		if (membership.outcome === FleetMembershipEvidenceOutcomes.Denied)
		{
			return { outcome: "denied", reason: "membership_stale" };
		}
		const verifiedAssertion = await identityAuthority.loadVerifiedPersonalAssertion(membership.evidence.issuerId, command.siloId, membership.evidence.revision, membership.evidence.payloadDigest, command.executionSubjectId);
		if (verifiedAssertion === null || verifiedAssertion.assertionId !== membership.evidence.assertionId)
		{
			return { outcome: "denied", reason: "membership_stale" };
		}

		// 4. Recheck exact service invocation authority before freezing the run's maximum access.
		const authorization = transaction.authorization;
		if (authorization === undefined)
			return { outcome: "denied", reason: "identity_unavailable" };
		const argumentsValue = { agentServiceId: run.agentServiceId, agentRevisionId: run.agentRevisionId, effectiveContractDigest: run.effectiveContractDigest };
		const admission = await authorization.admitPrincipal({ siloId: command.siloId, principalId, actorKind: "user", actorId: principalId, resource: { kind: ProductAuthorizationResourceKinds.AgentService, id: run.agentServiceId }, action: ProductAuthorizationActions.Invoke, argumentsDigest: ___DigestCanonicalJson(argumentsValue as JsonValue), membershipRevision: membership.evidence.revision, nowEpochMs: transaction.admittedAtEpochMs });
		if (admission.outcome !== AuthorizationDecisionOutcomes.Allow || admission.evidence === null)
		{
			return { outcome: "denied", reason: "identity_unavailable" };
		}

		// 5. Hash the verified membership and winning central decision into the frozen ceiling.
		const capabilitySetDigest = __DigestCanonicalJson({
			siloId: command.siloId,
			executionSubjectId: command.executionSubjectId,
			executionIssuer: command.executionIssuer,
			agentServiceId: run.agentServiceId,
			agentRevisionId: run.agentRevisionId,
			effectiveContractDigest: run.effectiveContractDigest,
			fleetMembershipRevision: membership.evidence.revision,
			fleetMembershipPayloadDigest: membership.evidence.payloadDigest,
			personalBoundaryPrincipalId: principalId,
			authorizationDecisionDigest: admission.evidence.decisionDigest,
			authorizationPolicyRevisionHash: admission.evidence.policyRevisionHash,
			effectiveAuthorizationDigest: admission.evidence.effectiveAuthorizationDigest,
		} as JsonValue);
		return {
			outcome: "loaded",
			value: {
				kind: RunInputSnapshotIdentityKinds.User,
				executionSubjectId: membership.evidence.subjectId,
				executionIssuer: command.executionIssuer,
				principalId,
				fleetMembershipRevision: membership.evidence.revision,
				fleetMembershipIssuer: membership.evidence.issuerId,
				fleetMembershipIssuerKeyId: membership.evidence.issuerKeyId,
				fleetMembershipAssertionId: membership.evidence.assertionId,
				fleetMembershipPayloadDigest: membership.evidence.payloadDigest,
				fleetMembershipTrustedUntil: new Date(membership.evidence.trustedUntilEpochMs).toISOString(),
				capabilitySetDigest,
			},
		};
	}
}
