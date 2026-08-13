/**
 * Public entry point for `@opencrane/backend/agents/execution/runs`, the package that owns the life
 * of one agent run: admitting it, dispatching it, reporting on it, cancelling it, and retrying it.
 *
 * What comes out of here is what another package needs to compose or drive a run — ready-to-mount
 * routers, transaction-owning authorities, the OpenAPI path fragments, the run-input digest, the
 * workload cleanup, and the port types an app must implement or pass through.
 *
 * The narrowed `export type` lists further down are deliberate. Anything not named there stays
 * inside the package. Run retry exposes only `RunRetryAuthority` and its request/result shapes;
 * transaction repositories and the domain decision remain internal so another package cannot go
 * around the package-owned transaction boundary. The same applies to workload-assignment helpers
 * and shapes, which are not exported at all.
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
export type { RunRetryAuthority, StartNextRunAttemptCommand, StartNextRunAttemptResult } from "./run-authority.types.js";
export { PrismaAgentRunRetryUnitOfWork } from "./prisma-run-retry-unit-of-work.js";
