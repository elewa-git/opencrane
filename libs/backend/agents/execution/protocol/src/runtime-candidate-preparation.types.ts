import type { ToolInvocationIntent } from "@opencrane/backend/server/iam/authorization";

/**
 * Invocation facts that compilation and schema validation accept before authorization runs.
 *
 * The dispatch transaction builds this value before it asks the central authority for permission.
 * That ordering prevents an allow decision from committing when the proposed tool arguments cannot
 * produce a ToolInvocation. The authorization evidence is attached only after the authority allows
 * the operation.
 *
 * Called by: `_PrepareToolInvocation` and `_BindToolInvocationAuthorization` in
 * `runtime-candidate-preparation.ts`.
 * @see ToolInvocationIntent
 */
export type RuntimeToolInvocationPreparation = Omit<ToolInvocationIntent, "authorizationEvidence">;
