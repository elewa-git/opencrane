import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { __AssembleRunInputSnapshot, __CreatePrismaPersonalSessionAssemblyAuthorities, PersonalExecutionIdentityEnvelopeSource, PrismaSkillRevisionEligibilitySource } from "@opencrane/backend/agents/execution/inputs";
import { ___CreateLogger } from "@opencrane/backend/observability";
import { PrismaRunAdmissionRepository } from "@opencrane/backend/agents/execution/runs";
import type { FleetMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { __CreatePersonalRunAdmissionPortWithGate } from "./personal-run-admission";
import { PrismaPersonalRunAdmissionUnitOfWork } from "./prisma-personal-run-admission-unit-of-work";
import type { PersonalRunAdmissionPort } from "./personal-run-admission.types";
import type { RunAdmissionCapacityGate } from "./managed-run-admission.types";

/**
 * Builds the personal browser-run admission port from readers that run inside the admission
 * transaction.
 *
 * The application supplies the identity settings, including the mounted signing key, and the one
 * process gate it also gives managed admission. This library never reads HTTP requests or
 * environment.
 *
 * Called by: apps/opencrane/src/index.ts. The result is passed to `_CreateSelfConversationsRouter`,
 * which hands it to `PrismaConversationMessageAdmissionUnitOfWork`
 * (libs/backend/server/conversations/main/src/db/prisma-conversation-message-admission-unit-of-work.ts).
 *
 * @param prisma - The product database client.
 * @param capacityGate - The shared capacity gate. Pass the same instance
 * {@link __CreateManagedRunAdmissionPort} was given, or the process admits at double its ceiling.
 * @param identityEvidence - Trusted issuer, verifier, and staleness bound for signed fleet
 * membership. Validated eagerly, so a bad value fails at startup.
 * @param workflow - Guarded engine that saves the controller-owned task with every accepted run.
 * @returns The port the conversations layer calls to start a user's run, or to create a child
 * Agent-thread conversation and its first run in one transaction. See
 * {@link PersonalRunAdmissionPort} for both entry points.
 * @throws When `identityEvidence` is incomplete — surfaced from the
 * {@link PersonalExecutionIdentityEnvelopeSource} constructor at startup, not per request.
 */
export function __CreatePersonalRunAdmissionPort(prisma: PrismaClient, capacityGate: RunAdmissionCapacityGate, identityEvidence: FleetMembershipEvidenceConfig, workflow: Pick<IWorkflowEngine, "spawn">): PersonalRunAdmissionPort
{
	// 1. The repository that owns the admission transaction and writes the AgentRun row with its input
	// snapshot. It also takes the advisory lock on silo plus idempotency key, which is what makes two
	// racing calls with the same key resolve to one run instead of two.
	const admission = new PrismaRunAdmissionRepository(prisma, workflow);

	// 2. The input sources session assembly reads inside that transaction. Identity and skill
	// eligibility are passed in because signed membership and grant policy are owned elsewhere; the
	// factory fills in the rest, including the personal-memory readers a managed run does not get.
	const authorities = __CreatePrismaPersonalSessionAssemblyAuthorities(admission, new PersonalExecutionIdentityEnvelopeSource(identityEvidence), new PrismaSkillRevisionEligibilitySource());

	// 3. The preflight reads run before the assembly transaction exists, so they need a repository
	// that opens its own short transaction per call. That is what the Unit of Work adds over
	// PrismaPersonalRunAdmissionRepository, which has to be handed a transaction.
	const personalAdmissionRepository = new PrismaPersonalRunAdmissionUnitOfWork(prisma);

	// 4. Hand the port its dependencies. Nothing above reads an HTTP request or an environment
	// variable, which is what keeps this library testable and the app the only place that reads config.
	return __CreatePersonalRunAdmissionPortWithGate({
		repository: personalAdmissionRepository,
		capacityGate,
		logger: ___CreateLogger("personal-run-admission"),
		// Fills in the parts of the snapshot command this library decides — a fresh run id, the
		// `user` identity kind and `interactive` trigger — and passes the caller's `commit` and
		// `prepare` straight through. `prepare` must be forwarded, not dropped: the Agent-thread
		// caller uses it to create the child conversation and resolve its persona inside the
		// admission transaction, and the sources above read that child while assembling the snapshot.
		assemble: async function _assemble(command, authority, commit, prepare)
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
				executionIssuer: command.executionIssuer,
				requestIdempotencyKey: command.requestIdempotencyKey,
			}, authorities, commit, prepare);
		},
	});
}
