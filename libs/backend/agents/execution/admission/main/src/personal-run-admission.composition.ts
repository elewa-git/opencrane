import type { PrismaClient } from "@prisma/client";

import { __AssembleRunInputSnapshot, __CreatePrismaSessionAssemblyAuthorities } from "@opencrane/backend/agents/execution/inputs";
import { ___CreateLogger } from "@opencrane/backend/observability";
import { PrismaRunAdmissionUnitOfWork } from "@opencrane/backend/agents/execution/runs";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import type { ExecutionSubjectAdmissionAuthority } from "./execution-subject-admission.types";
import { __CreatePersonalRunAdmissionPortWithGate } from "./personal-run-admission";
import { PrismaPersonalRunAdmissionUnitOfWork } from "./prisma-personal-run-admission-unit-of-work";
import type { PersonalRunAdmissionPort } from "./personal-run-admission.types";
import type { RunAdmissionCapacityGate } from "./managed-run-admission.types";

/**
 * Builds the personal browser-run admission port from readers that run inside the admission
 * transaction.
 *
 * The application supplies the canonical execution-subject authority and the one process gate it
 * also gives managed admission. This library never reads HTTP requests or environment.
 *
 * Called by: apps/opencrane/src/index.ts. The result is passed to `_CreateSelfConversationsRouter`,
 * which hands it to `PrismaConversationMessageAdmissionUnitOfWork`
 * (libs/backend/server/conversations/main/src/db/prisma-conversation-message-admission-unit-of-work.ts).
 *
 * @param prisma - The product database client.
 * @param workflow - Guarded workflow engine that saves the AgentRun task in the admission transaction.
 * @param capacityGate - The shared capacity gate. Pass the same instance
 * {@link __CreateManagedRunAdmissionPort} was given, or the process admits at double its ceiling.
 * @param executionSubjectAuthority - Resolves the canonical subject from request provenance inside
 * the final admission transaction. It must join checked AgentIdentity history,
 * current membership, capability policy, and an active ConversationComputer lease.
 * @returns The port the conversations layer calls to start a user's run, or to create a child
 * Agent-thread conversation and its first run in one transaction. See
 * {@link PersonalRunAdmissionPort} for both entry points.
 */
export function __CreatePersonalRunAdmissionPort(prisma: PrismaClient, workflow: Pick<IWorkflowEngine, "spawn">, capacityGate: RunAdmissionCapacityGate, executionSubjectAuthority: ExecutionSubjectAdmissionAuthority): PersonalRunAdmissionPort
{
	// 1. The repository that owns the admission transaction and writes the AgentRun row with its input
	// snapshot. It also takes the advisory lock on silo plus idempotency key, which is what makes two
	// racing calls with the same key resolve to one run instead of two.
	const admission = new PrismaRunAdmissionUnitOfWork(prisma, workflow);

	// 2. The input sources recheck the subject inside the same transaction that writes the snapshot.
	// The application owns the joined history and policy authority, so admission cannot recreate it
	// from browser fields or an identity-kind branch.
	const authorities = __CreatePrismaSessionAssemblyAuthorities(admission, executionSubjectAuthority);

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
		// Builds only the run coordinates and requester provenance. `prepare`
		// must be forwarded: the Agent-thread caller creates the child conversation before the sources
		// read it in the admission transaction.
		assemble: async function _assemble(command, authority, commit, prepare)
		{
			return __AssembleRunInputSnapshot({
				runId: command.runId,
				siloId: command.siloId,
				agentServiceId: authority.agentServiceId,
				conversationId: command.conversationId,
				inputMessageId: command.inputMessageId,
				inputMessageBlocks: command.inputMessageBlocks,
				trigger: "interactive",
				requestIdempotencyKey: command.requestIdempotencyKey,
				requester: { subjectId: command.requesterSubjectId, issuer: command.requesterIssuer, authenticatedAt: command.requesterAuthenticatedAt },
			}, authorities, commit, prepare);
		},
	});
}
