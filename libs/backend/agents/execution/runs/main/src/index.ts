/**
 * Public entry point for `@opencrane/backend/agents/execution/runs`, the package that owns the life
 * of one personal conversation run: admission, immutable input, lifecycle, and owner-visible status.
 *
 * What comes out of here is what another package needs to compose or drive a run — ready-to-mount
 * routers, transaction-owning authorities, the OpenAPI path fragments, the run-input digest, and
 * the ports an app must implement or pass through.
 *
 * The narrowed `export type` lists further down are deliberate. Anything not named there stays
 * inside the package. Transaction repositories and row mappers remain internal so another package
 * cannot go around the package-owned transaction boundaries.
 *
 * Imported by: apps/opencrane composition and route files, libs/backend/agents/execution
 * (admission, inputs, protocol), libs/backend/server/conversations, and
 * libs/backend/server/api-spec for the OpenAPI fragments.
 */
export * from "./attempt-model-key.types";
export * from "./openapi";
export * from "./prisma-run-admission-unit-of-work";
export * from "./prisma-conversation-run-lifecycle-authority";
export * from "./conversation-run-lifecycle.types";
export * from "./prisma-tool-recovery-event-reporter";
export * from "./prisma-tool-invocation-lifecycle-event-reporter";
export * from "./prisma-tool-invocation-run-recovery-authority";
export * from "./tool-recovery-event-reporter.types";
export type { ToolInvocationLifecycleEventAppendRepository, ToolInvocationLifecycleEventAppendUnitOfWork, ToolInvocationLifecycleEventUnitOfWork } from "./tool-invocation-lifecycle-event-reporter.types";
export type { ToolInvocationRunRecoveryRepository, ToolInvocationRunRecoveryUnitOfWork } from "./tool-invocation-run-recovery-authority.types";
export * from "./prisma-self-run-status.router";
export * from "./run-admission-concurrency";
export { RunAdmissionConcurrencyDenialReasons, RunAdmissionConcurrencyOutcomes } from "./run-admission-concurrency.types";
export type { RunAdmissionConcurrencyPolicy, RunAdmissionConcurrencyResult } from "./run-admission-concurrency.types";
export * from "./run-admission.types";
export type { RunAdmissionPersistenceRepository } from "./run-admission-persistence.types";
export * from "./run-input-snapshot-digest";
