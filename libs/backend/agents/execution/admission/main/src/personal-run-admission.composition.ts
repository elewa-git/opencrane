import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { __AssembleRunInputSnapshot, __CreatePrismaPersonalSessionAssemblyAuthorities, PersonalExecutionIdentityEnvelopeSource, PrismaSkillRevisionEligibilitySource, type PersonalMemoryFactSelector } from "@opencrane/backend/agents/execution/inputs";
import { ___CreateLogger } from "@opencrane/backend/observability";
import { PrismaRunAdmissionRepository } from "@opencrane/backend/agents/execution/runs";
import type { FleetMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";

import { __CreatePersonalRunAdmissionPortWithGate } from "./personal-run-admission.js";
import { PrismaPersonalRunAdmissionUnitOfWork } from "./prisma-personal-run-admission-unit-of-work.js";
import type { PersonalRunAdmissionPort } from "./personal-run-admission.types.js";
import type { RunAdmissionCapacityGate } from "./managed-run-admission.types.js";

/**
 * Composes one personal browser-run admission port from transaction-fenced product authorities.
 *
 * The application supplies the mounted-key-backed identity configuration and the single process
 * gate it also gives managed admission. This library never reads HTTP requests or environment.
 */
export function __CreatePersonalRunAdmissionPort(prisma: PrismaClient, capacityGate: RunAdmissionCapacityGate, identityEvidence: FleetMembershipEvidenceConfig, memoryFactSelector: PersonalMemoryFactSelector): PersonalRunAdmissionPort
{
	const admission = new PrismaRunAdmissionRepository(prisma);
	const authorities = __CreatePrismaPersonalSessionAssemblyAuthorities(admission, new PersonalExecutionIdentityEnvelopeSource(identityEvidence), new PrismaSkillRevisionEligibilitySource(), memoryFactSelector);
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
