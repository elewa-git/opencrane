/** Durable result emitted after one transaction-fenced personal configuration reconciliation. */
export interface PersonalConfigurationMaterializationResult
{
	/** Whether one accepted model choice produced a new current AgentRevision. */
	readonly state: "materialized" | "unchanged";
}

/** Persisted current revision facts cloned into the next personal model revision. */
export interface PersonalRevisionCloneSource
{
	/** Stable source revision identity used as the direct lineage parent. */
	readonly id: string;
	/** Service that owns the immutable lineage. */
	readonly agentServiceId: string;
	/** Current monotonic revision number. */
	readonly revision: number;
	/** Prompt policy carried forward unchanged. */
	readonly promptPolicyVersion: string;
	/** Approved persona retained by a model-only change. */
	readonly personaRevisionId: string | null;
	/** Effective immutable budget carried forward unchanged. */
	readonly budget: import("@prisma/client").Prisma.JsonValue;
	/** Immutable skill assignment rows to clone. */
	readonly skillAssignments: readonly { readonly skillId: string; readonly skillRevisionId: string }[];
	/** Immutable integration assignment rows to clone. */
	readonly integrationAssignments: readonly { readonly integrationId: string; readonly siloId: string; readonly custodyReferenceId: string; readonly allowedTools: readonly string[] }[];
	/** Immutable scope attachment rows to clone. */
	readonly scopeAttachments: readonly { readonly scope: string; readonly subjectType: string; readonly subjectId: string }[];
}
