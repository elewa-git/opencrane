import type { RunInputSnapshot } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

/** The fields of one accepted upgrade_session tool call. */
export interface UpgradeSessionInvocation
{
	/** Run that owns the requested future configuration change. */
	readonly runId: string;
	/** Attempt that admitted the action. */
	readonly attempt: number;
	/** Immutable built-in tool revision. */
	readonly toolRevisionId: string;
	/** Tool-invocation id, kept so the proposal can be traced back in audit records. */
	readonly toolInvocationId: string;
	/**
	 * `sha256:<hex>` digest of `arguments` in canonical JSON form, stored on the proposal as its
	 * `requestedPatchDigest`.
	 *
	 * @see https://www.rfc-editor.org/rfc/rfc8785 — RFC 8785 (JSON Canonicalization Scheme), the
	 * rules that make this digest reproducible.
	 */
	readonly argumentsDigest: string;
	/** Canonical validated proposed patch. */
	readonly arguments: JsonValue;
}

/** What is recorded as the tool's result for one accepted upgrade_session call. */
export interface UpgradeSessionProposalReceipt
{
	/** Index signature, so the receipt is still a plain JSON object, as a tool result must be. */
	readonly [key: string]: JsonValue;
	/** Id of the recorded proposal; deciding it later affects only a future run. */
	readonly changeId: string;
}

/**
 * Turns one `upgrade_session` tool call into a recorded configuration proposal.
 *
 * The bridge between an agent run and this package: the agent asks for a change, this records
 * the request, and the user decides it later. Nothing about the running agent changes.
 *
 * Called by: `production-external-action-adapter.ts` in
 * libs/backend/agents/execution/protocol, as its `personalConfiguration` dependency.
 *
 * @see {@link PrismaUpgradeSessionProposalRepository} for the transaction-scoped implementation.
 */
export interface UpgradeSessionProposalRepository
{
	/**
	 * Records the tool call's requested change as a proposal for the snapshot's user.
	 *
	 * @param candidate - The accepted tool call, with its validated arguments and digest.
	 * @param snapshot - The run's immutable input snapshot; supplies the owner, silo, service,
	 * conversation and the revision ids the proposal freezes.
	 * @param now - Server time recorded as the proposal instant.
	 * @returns A receipt carrying the new `changeId`, recorded as the tool's result.
	 * @throws Error when the snapshot is not a personal conversation run, when the patch is not a
	 * supported shape, when the user has no persona profile, or when the proposal is refused. The
	 * runtime turns a throw into a failed tool call rather than a silent no-op.
	 */
	proposeUpgradeSession(candidate: UpgradeSessionInvocation, snapshot: RunInputSnapshot, now: string): Promise<UpgradeSessionProposalReceipt>;
}

/** Same operation, but it opens its own transaction. */
export interface UpgradeSessionProposalUnitOfWork extends UpgradeSessionProposalRepository {}
