import type { RunInputSnapshot } from "@opencrane/contracts";

import type { GovernedChildRunSpawnAuthorization } from "./child-run-admission.types.js";

/** Immutable server-verified facts needed to derive one child snapshot from its parent. */
export interface ChildRunSnapshotCommand
{
	/** New child logical-run identifier. */
	readonly childRunId: string;
	/** Parent snapshot that bounds every copied child input. */
	readonly parentSnapshot: RunInputSnapshot;
	/** Previously authorised context, capability digest, and finite budget allocation. */
	readonly authorization: GovernedChildRunSpawnAuthorization;
	/** Published child revision selected by the server-side service authority. */
	readonly agentRevisionId: string;
	/** Effective contract digest fixed by the published child revision. */
	readonly effectiveContractDigest: string;
	/** Prompt compiler version fixed by the published child revision. */
	readonly promptCompilerVersion: string;
	/** Canonical server-owned compilation instant. */
	readonly compiledAt: string;
}
