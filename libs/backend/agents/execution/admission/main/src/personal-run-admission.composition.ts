import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { __AssembleRunInputSnapshot, __CreatePrismaPersonalSessionAssemblyAuthorities, PersonalExecutionIdentityEnvelopeSource, PrismaSkillRevisionEligibilitySource } from "@opencrane/backend/agents/execution/inputs";
import { ___CreateLogger } from "@opencrane/backend/observability";
import { PrismaRunAdmissionRepository } from "@opencrane/backend/agents/execution/runs";
import type { FleetMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";

import { __CreatePersonalRunAdmissionPortWithGate } from "./personal-run-admission.js";
import { PrismaPersonalRunAdmissionUnitOfWork } from "./prisma-personal-run-admission-unit-of-work.js";
import type { PersonalRunAdmissionPort } from "./personal-run-admission.types.js";
import type { RunAdmissionCapacityGate } from "./managed-run-admission.types.js";

/**
 * Builds the personal browser-run admission port from readers that run inside the admission
 * transaction.
 *
 * The application supplies the identity settings, including the mounted signing key, and the one
 * process gate it also gives managed admission. This library never reads HTTP requests or
 * environment.
 *
 * Called by: apps/opencrane/src/index.ts. The result is handed to the conversations router, which
 * reaches it through `PrismaConversationUnitOfWork`
 * (libs/backend/server/conversations/main/src/prisma-conversation-unit-of-work.ts).
 *
 * @param prisma - The product database client.
 * @param capacityGate - The shared capacity gate. Pass the same instance
 * {@link __CreateManagedRunAdmissionPort} was given, or the process admits at double its ceiling.
 * @param identityEvidence - Trusted issuer, verifier, and staleness bound for signed fleet
 * membership. Validated eagerly, so a bad value fails at startup.
 * @param memoryFactSelector - Gateway-backed fact selector; it must throw on transport failure. See
 * {@link PersonalMemoryFactSelector}.
 * @returns The port the conversations layer calls to start a user's run.
 * @throws When `identityEvidence` is incomplete — surfaced from the
 * {@link PersonalExecutionIdentityEnvelopeSource} constructor at startup, not per request.
 */
export function __CreatePersonalRunAdmissionPort(prisma: PrismaClient, capacityGate: RunAdmissionCapacityGate, identityEvidence: FleetMembershipEvidenceConfig): PersonalRunAdmissionPort
{
	const admission = new PrismaRunAdmissionRepository(prisma);
	const authorities = __CreatePrismaPersonalSessionAssemblyAuthorities(admission, new PersonalExecutionIdentityEnvelopeSource(identityEvidence), new PrismaSkillRevisionEligibilitySource());
	const personalAdmissionRepository = new PrismaPersonalRunAdmissionUnitOfWork(prisma);
	return __CreatePersonalRunAdmissionPortWithGate({
		repository: personalAdmissionRepository,
		capacityGate,
		logger: ___CreateLogger("personal-run-admission"),
		assemble: async function _assemble(command, authority, commit)
		{
			return __AssembleRunInputSnapshot({
				runId: randomUUID(),
				siloId: command.siloId,
				agentServiceId: authority.agentServiceId,
				conversationId: command.conversationId,
				inputMessageId: command.inputMessageId,
				inputMessageBlocks: command.inputMessageBlocks,
				identityKind: "user",
				trigger: "interactive",
				executionSubjectId: command.executionSubjectId,
				requestIdempotencyKey: command.requestIdempotencyKey,
			}, authorities, commit);
		},
	});
}
