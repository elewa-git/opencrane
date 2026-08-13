/**
 * Public entry point for `@opencrane/backend/agents/execution/runs`, the package that owns the life
 * of one agent run: admitting it, dispatching it, reporting on it, cancelling it, and retrying it.
 *
 * What comes out of here is what another package needs to compose or drive a run — ready-to-mount
 * routers, the Prisma adapters behind them, the OpenAPI path fragments, the run-input digest, the
 * workload cleanup, and the port types an app must implement or pass through.
 *
 * The narrowed `export type` lists further down are deliberate. Anything not named there stays
 * inside the package, and the retry surface is the clearest case: `__StartNextRunAttempt` and
 * {@link AgentRunAuthorityRepository} are exported, but `AtomicStartNextRunAttemptCommand` and
 * `AtomicRunAttemptResult` are not, so no other package can build the argument to
 * `startNextAttemptAtomically` and go around the checks in `__StartNextRunAttempt`. The same applies
 * to `__ValidateRunWorkloadAssignment` and the workload-assignment shapes, which are not exported at
 * all. Reach for the exported function, not for a deeper file path.
 *
 * Imported by: apps/opencrane composition and route files, libs/backend/agents/execution
 * (admission, inputs, protocol), libs/backend/server/conversations, and
 * libs/backend/server/api-spec for the OpenAPI fragments.
 */
export * from "./attempt-model-key.types.js";
export * from "./openapi.js";
export { PrismaRunAdmissionRepository } from "./prisma-run-admission-repository.js";
export * from "./prisma-run-cancellation-repository.js";
export * from "./prisma-run-dispatch-repository.js";
export * from "./prisma-self-run-cancellation.router.js";
export * from "./prisma-runtime-terminal-reporter.js";
export * from "./prisma-runtime-event-reporter.js";
export * from "./prisma-tool-recovery-event-reporter.js";
export * from "./prisma-tool-invocation-lifecycle-event-reporter.js";
export * from "./prisma-tool-invocation-run-recovery-authority.js";
export * from "./runtime-event-reporter.types.js";
export * from "./tool-recovery-event-reporter.types.js";
export type { ToolInvocationLifecycleEventAppendRepository, ToolInvocationLifecycleEventAppendUnitOfWork, ToolInvocationLifecycleEventUnitOfWork } from "./tool-invocation-lifecycle-event-reporter.types.js";
export type { ToolInvocationRunRecoveryRepository, ToolInvocationRunRecoveryUnitOfWork } from "./tool-invocation-run-recovery-authority.types.js";
export * from "./prisma-self-run-status.router.js";
export * from "./run-admission-concurrency.js";
export { RunAdmissionConcurrencyDenialReasons, RunAdmissionConcurrencyOutcomes } from "./run-admission-concurrency.types.js";
export type { RunAdmissionConcurrencyPolicy, RunAdmissionConcurrencyResult } from "./run-admission-concurrency.types.js";
export * from "./run-admission.types.js";
export type { RunCancellationRepository } from "./run-cancellation.types.js";
export * from "./run-dispatch.router.js";
export * from "./run-input-snapshot-digest.js";
export * from "./runtime-workload-cleanup.js";
export { __StartNextRunAttempt } from "./run-authority.js";
export type { AgentRunAuthorityRepository, StartNextRunAttemptCommand, StartNextRunAttemptResult } from "./run-authority.types.js";
export { PrismaAgentRunAuthorityRepository } from "./prisma-run-authority.js";
