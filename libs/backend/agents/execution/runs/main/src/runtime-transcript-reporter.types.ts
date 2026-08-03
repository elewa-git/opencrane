import type { Prisma } from "@prisma/client";

import type { RuntimeEventCandidate } from "@opencrane/contracts";

/** Result of persisting one non-terminal runtime event under the accepted attempt fence. */
export type RuntimeTranscriptReportResult =
	| { readonly outcome: "reported" }
	| { readonly outcome: "denied"; readonly reason: "run_not_current" | "unsupported_runtime_event" };

/** Transaction-scoped port from runtime candidate admission to canonical replay evidence. */
export interface RuntimeTranscriptReporter
{
	/** Persist one bounded runtime event without changing the terminal run lifecycle. */
	reportInTransaction(transaction: Prisma.TransactionClient, candidate: RuntimeEventCandidate): Promise<RuntimeTranscriptReportResult>;
}
