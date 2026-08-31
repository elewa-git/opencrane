import type { PrismaClient } from "@prisma/client";

import { PrismaRunCancellationUnitOfWork, type RunCancellationRepository } from "@opencrane/backend/agents/execution/runs";

/** Compose the cancellation transaction used by the public self-run route. */
export function _CreateRunCancellationAuthority(prisma: PrismaClient): RunCancellationRepository
{
	return new PrismaRunCancellationUnitOfWork(prisma);
}
