import type { PrismaClient } from "@prisma/client";

import { PrismaRunCancellationUnitOfWork, type RunCancellationRepository, type SelfRunCancellationRepository } from "@opencrane/backend/agents/execution/runs";

/** Compose the cancellation transaction used by the public self-run route. */
export function _CreateRunCancellationAuthority(prisma: PrismaClient): RunCancellationRepository & SelfRunCancellationRepository
{
	return new PrismaRunCancellationUnitOfWork(prisma);
}
