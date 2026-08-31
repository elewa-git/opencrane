import type { SkillAuthoringValidationBindOutcome, SkillAuthoringValidationCompletion, SkillAuthoringValidationControllerAuthority, SkillAuthoringValidationControllerRecord, SkillAuthoringValidationCurrentStatus, SkillAuthoringValidationPodBindCommand, SkillAuthoringValidationRecoveryOutcome, SkillAuthoringValidationRecoveryReasons, SkillAuthoringValidationReleaseOutcome, SkillAuthoringValidationWorkloadBindCommand } from "@opencrane/backend/agents/skills/workflows/contract";
import type { ControllerExchangeOptions } from "@opencrane/backend/agents/runtime/workloads/controller-transport";
import { __CreateControllerExchange, __RequireControllerRouteId } from "@opencrane/backend/agents/runtime/workloads/controller-transport";
import type { RuntimeWorkloadBinding, RuntimeWorkloadClaim } from "@opencrane/backend/agents/runtime/workloads/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { _ParseSkillAuthoringValidationBindOutcome, _ParseSkillAuthoringValidationCompletion, _ParseSkillAuthoringValidationCompletionOutcome, _ParseSkillAuthoringValidationControllerRecord, _ParseSkillAuthoringValidationCurrentStatus, _ParseSkillAuthoringValidationRecoveryOutcome, _ParseSkillAuthoringValidationReleaseOutcome } from "./skill-authoring-validation-http-response";

/** Build the private route path for one validation. */
function _Route(validationId: string, suffix: string): string
{
	return `/api/internal/agent-controller/skill-authoring-validations/${encodeURIComponent(validationId)}/${suffix}`;
}

/**
 * Creates the authenticated server authority used by the controller-hosted validation handler.
 *
 * The shared controller transport validates the same-silo Service origin and reads the rotating
 * projected token; this adapter owns only the validation routes, trace names, and strict response
 * validators that keep another validation or an unsupported outcome from reaching Kubernetes
 * reconciliation.
 *
 * Called by: `apps/agent-controller/src/index.ts` when it registers the validation workflow handler.
 * @param options - Same-silo origin, projected-token path, timeout, shutdown signal, and test seams.
 * @returns The authority through which the handler claims, binds, loads, and completes a validation.
 * @see __CreateControllerExchange for the shared transport boundary.
 */
export function __CreateHttpSkillAuthoringValidationControllerAuthority(options: ControllerExchangeOptions): SkillAuthoringValidationControllerAuthority
{
	const transport = __CreateControllerExchange("skill authoring validation", options);

	return {
		async claimForTask(validationId: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationControllerRecord | null>
		{
			const acceptedValidationId = __RequireControllerRouteId(validationId, "validation id");
			return ___DoWithTrace("agent_controller.skill_authoring_validation.claim", { validationId: acceptedValidationId }, async function _Claim(): Promise<SkillAuthoringValidationControllerRecord | null>
			{
				return await transport.exchange({ path: _Route(acceptedValidationId, "claim"), method: "POST", body: task, conflict: null, failure: "skill authoring validation claim", parse: function _Validate(value: unknown): SkillAuthoringValidationControllerRecord { return _ParseSkillAuthoringValidationControllerRecord(value, acceptedValidationId); } });
			});
		},
		async loadCurrentStatus(validationId: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationCurrentStatus>
		{
			const acceptedValidationId = __RequireControllerRouteId(validationId, "validation id");
			return ___DoWithTrace("agent_controller.skill_authoring_validation.status_current", { validationId: acceptedValidationId }, async function _LoadStatus(): Promise<SkillAuthoringValidationCurrentStatus>
			{
				return await transport.exchange({ path: _Route(acceptedValidationId, "status/current"), method: "POST", body: task, failure: "skill authoring validation current status", parse: function _Validate(value: unknown): SkillAuthoringValidationCurrentStatus { return _ParseSkillAuthoringValidationCurrentStatus(value, acceptedValidationId); } });
			});
		},
		async failExpiredBeforeWorkload(validationId: string, task: IWorkflowTaskReceipt, claim: RuntimeWorkloadClaim): Promise<SkillAuthoringValidationRecoveryOutcome>
		{
			const acceptedValidationId = __RequireControllerRouteId(validationId, "validation id");
			return ___DoWithTrace("agent_controller.skill_authoring_validation.unbound_expiry", { validationId: acceptedValidationId, deliveryCount: claim.deliveryCount }, async function _FailExpired(): Promise<SkillAuthoringValidationRecoveryOutcome>
			{
				return await transport.exchange({ path: _Route(acceptedValidationId, "failure/unbound-expiry"), method: "POST", body: { task, claim }, conflict: "conflict" as const, failure: "skill authoring validation unbound expiry", parse: function _Validate(value: unknown): Exclude<SkillAuthoringValidationRecoveryOutcome, "conflict"> { return _ParseSkillAuthoringValidationRecoveryOutcome(value, acceptedValidationId); } });
			});
		},
		async bindWorkload(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationWorkloadBindCommand): Promise<SkillAuthoringValidationBindOutcome>
		{
			const acceptedValidationId = __RequireControllerRouteId(validationId, "validation id");
			return ___DoWithTrace("agent_controller.skill_authoring_validation.workload_binding", { validationId: acceptedValidationId, workloadUid: command.binding.workloadUid }, async function _BindWorkload(): Promise<SkillAuthoringValidationBindOutcome>
			{
				return await transport.exchange({ path: _Route(acceptedValidationId, "workload-binding"), method: "PUT", body: { task, ...command }, conflict: "conflict" as const, failure: "skill authoring validation workload binding", parse: function _Validate(value: unknown): Exclude<SkillAuthoringValidationBindOutcome, "conflict"> { return _ParseSkillAuthoringValidationBindOutcome(value, acceptedValidationId); } });
			});
		},
		async authorizeRelease(validationId: string, task: IWorkflowTaskReceipt, binding: RuntimeWorkloadBinding): Promise<SkillAuthoringValidationReleaseOutcome>
		{
			const acceptedValidationId = __RequireControllerRouteId(validationId, "validation id");
			return ___DoWithTrace("agent_controller.skill_authoring_validation.release_authorization", { validationId: acceptedValidationId, workloadUid: binding.workloadUid }, async function _AuthorizeRelease(): Promise<SkillAuthoringValidationReleaseOutcome>
			{
				const requestStartedAt = performance.now();
				const outcome = await transport.exchange({ path: _Route(acceptedValidationId, "release-authorization"), method: "POST", body: { task, binding }, conflict: "conflict" as const, failure: "skill authoring validation release authorization", parse: function _Validate(value: unknown): Exclude<SkillAuthoringValidationReleaseOutcome, "conflict"> { return _ParseSkillAuthoringValidationReleaseOutcome(value, acceptedValidationId); } });
				if (outcome === "conflict" || outcome === "expired")
					return outcome;
				const releaseLifetimeSeconds = outcome.releaseLifetimeSeconds - Math.ceil((performance.now() - requestStartedAt) / 1_000);
				return releaseLifetimeSeconds < 1 ? "expired" : { outcome: "authorized", releaseLifetimeSeconds };
			});
		},
		async bindFirstPod(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationPodBindCommand): Promise<SkillAuthoringValidationBindOutcome>
		{
			const acceptedValidationId = __RequireControllerRouteId(validationId, "validation id");
			return ___DoWithTrace("agent_controller.skill_authoring_validation.pod_binding", { validationId: acceptedValidationId, podUid: command.binding.firstPodUid }, async function _BindFirstPod(): Promise<SkillAuthoringValidationBindOutcome>
			{
				return await transport.exchange({ path: _Route(acceptedValidationId, "pod-binding"), method: "PUT", body: { task, ...command }, conflict: "conflict" as const, failure: "skill authoring validation Pod binding", parse: function _Validate(value: unknown): Exclude<SkillAuthoringValidationBindOutcome, "conflict"> { return _ParseSkillAuthoringValidationBindOutcome(value, acceptedValidationId); } });
			});
		},
		async loadCurrentCompletion(validationId: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationCompletion | null>
		{
			const acceptedValidationId = __RequireControllerRouteId(validationId, "validation id");
			return ___DoWithTrace("agent_controller.skill_authoring_validation.completion_current", { validationId: acceptedValidationId }, async function _LoadCurrent(): Promise<SkillAuthoringValidationCompletion | null>
			{
				return await transport.exchange<SkillAuthoringValidationCompletion | null>({ path: _Route(acceptedValidationId, "completion/current"), method: "POST", body: task, noContent: null, failure: "skill authoring validation current completion", parse: function _Validate(value: unknown): SkillAuthoringValidationCompletion { return _ParseSkillAuthoringValidationCompletion(value, acceptedValidationId); } });
			});
		},
		async failUnreported(validationId: string, task: IWorkflowTaskReceipt, binding: RuntimeWorkloadBinding, reason: SkillAuthoringValidationRecoveryReasons): Promise<SkillAuthoringValidationRecoveryOutcome>
		{
			const acceptedValidationId = __RequireControllerRouteId(validationId, "validation id");
			return ___DoWithTrace("agent_controller.skill_authoring_validation.failure_unreported", { validationId: acceptedValidationId, workloadUid: binding.workloadUid, reason }, async function _Fail(): Promise<SkillAuthoringValidationRecoveryOutcome>
			{
				return await transport.exchange({ path: _Route(acceptedValidationId, "failure/unreported"), method: "POST", body: { task, binding, reason }, conflict: "conflict" as const, failure: "skill authoring validation recovery", parse: function _Validate(value: unknown): Exclude<SkillAuthoringValidationRecoveryOutcome, "conflict"> { return _ParseSkillAuthoringValidationRecoveryOutcome(value, acceptedValidationId); } });
			});
		},
		async complete(validationId: string, completion: SkillAuthoringValidationCompletion, task: IWorkflowTaskReceipt): Promise<"completed" | "idempotent" | "conflict">
		{
			const acceptedValidationId = __RequireControllerRouteId(validationId, "validation id");
			return ___DoWithTrace("agent_controller.skill_authoring_validation.complete", { validationId: acceptedValidationId }, async function _Complete(): Promise<"completed" | "idempotent" | "conflict">
			{
				return await transport.exchange({ path: _Route(acceptedValidationId, "completion/complete"), method: "POST", body: { task, completion }, conflict: "conflict" as const, failure: "skill authoring validation completion", parse: function _Validate(value: unknown): "completed" | "idempotent" { return _ParseSkillAuthoringValidationCompletionOutcome(value, acceptedValidationId); } });
			});
		},
	};
}
