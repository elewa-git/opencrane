import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { PrismaPersonalMemoryOperationUnitOfWork } from "@opencrane/backend/agents/personal/memory";
import { PersonalMemoryOperationAuthority, PrismaKurrentPersonalMemoryMessageSource, PrismaPersonalMemoryOperationActorUnitOfWork, PrismaPersonalMemoryOperationAuthorizationUnitOfWork, PrismaPersonalMemoryOperationCatalogUnitOfWork, _RegisterPersonalMemoryOperationWorkflow, type SelfConversationHistoryAuthority } from "@opencrane/backend/server/conversations";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import type { PersonalMemoryWorkflowCompositionOptions } from "./personal-memory-operation-workflow-composition.types";

/** Registers saved memory work using the participant history authority already composed for this process. */
export function _CreatePersonalMemoryOperationWorkflowComposition(prisma: PrismaClient, history: Pick<SelfConversationHistoryAuthority, "read">, workflows: IWorkflowEngine, options: PersonalMemoryWorkflowCompositionOptions): void
{
	const authority = new PersonalMemoryOperationAuthority({
		siloId: options.siloId,
		operations: new PrismaPersonalMemoryOperationUnitOfWork(prisma),
		catalog: new PrismaPersonalMemoryOperationCatalogUnitOfWork(prisma, options.siloId),
		actors: new PrismaPersonalMemoryOperationActorUnitOfWork(prisma),
		authorization: new PrismaPersonalMemoryOperationAuthorizationUnitOfWork(prisma),
		sources: new PrismaKurrentPersonalMemoryMessageSource(history),
		gateway: options.gateway,
		clock: { now: function _Now() { return new Date(); } },
		ids: { create: randomUUID },
	});
	_RegisterPersonalMemoryOperationWorkflow(workflows, authority);
}
