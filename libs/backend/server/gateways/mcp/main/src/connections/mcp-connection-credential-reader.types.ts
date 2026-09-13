import type { McpConnectionCredential } from "@opencrane/contracts";

/** Outcomes from reading credential material after an exact dispatch claim commits. */
export enum McpConnectionCredentialReadOutcomes
{
	/** The active generation and any required material matched every saved coordinate. */
	Ready = "ready",
	/** No active generation exists at the requested coordinates. */
	NotFound = "not-found",
	/** Current owner, server, revision, or ProviderConnection authority no longer matches. */
	Denied = "denied",
	/** Saved Secret identity or material cannot be proved and the generation needs recovery. */
	RecoveryRequired = "recovery-required",
	/** Kubernetes did not provide enough evidence to make a safe dispatch decision. */
	Uncertain = "uncertain",
}

/** Exact immutable coordinates frozen by the already-committed dispatch claim. */
export interface McpConnectionCredentialReadCommand
{
	readonly siloId: string;
	readonly connectionId: string;
	readonly generation: number;
	readonly ownerPrincipalId: string;
	readonly serverId: string;
	readonly serverRevisionId: string;
}

/** Ephemeral credential returned only to the immediate remote-call executor. */
export type McpConnectionExecutionCredential = McpConnectionCredential;

/** Fail-closed result of reading the exact active generation after dispatch claim. */
export type McpConnectionCredentialReadResult =
	| { readonly outcome: McpConnectionCredentialReadOutcomes.Ready; readonly credential: McpConnectionExecutionCredential }
	| { readonly outcome: McpConnectionCredentialReadOutcomes.NotFound | McpConnectionCredentialReadOutcomes.Denied | McpConnectionCredentialReadOutcomes.RecoveryRequired | McpConnectionCredentialReadOutcomes.Uncertain };

/** Reads material only after a runtime has committed its exact one-call dispatch claim. */
export interface McpConnectionCredentialReader
{
	/** Return ephemeral material after checking the complete immutable generation binding. */
	readExact(command: McpConnectionCredentialReadCommand, signal?: AbortSignal): Promise<McpConnectionCredentialReadResult>;
}
