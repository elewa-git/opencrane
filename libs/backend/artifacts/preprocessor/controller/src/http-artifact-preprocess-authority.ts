import type { ArtifactPreprocessCompletion, ArtifactPreprocessControllerAuthority, ArtifactPreprocessControllerRecord, ArtifactPreprocessOutcome, ArtifactPreprocessPodBindCommand, ArtifactPreprocessRecoveryCommand, ArtifactPreprocessWorkloadBindCommand } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { ControllerExchangeOptions } from "@opencrane/backend/agents/runtime/workloads/controller-transport";
import { __CreateControllerExchange, __RequireControllerRouteId } from "@opencrane/backend/agents/runtime/workloads/controller-transport";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { _ParseArtifactPreprocessBindOutcome, _ParseArtifactPreprocessControllerRecord, _ParseArtifactPreprocessOutcome } from "./artifact-preprocess-http-response";

/** Build the private route path for one preprocessing Job. */
function _Route(preprocessJobId: string, suffix: string): string
{
	return `/api/internal/agent-controller/artifact-preprocess-jobs/${encodeURIComponent(preprocessJobId)}/${suffix}`;
}

/**
 * Create the internal HTTP authority that a controller-hosted workflow uses for one PDF Job.
 *
 * The shared controller transport reads a rotating projected token for every request and bounds
 * every response; this adapter owns only the artifact-preprocessing routes, trace names, and
 * response validators. A 409 returns `null` for a claim or `conflict` for a binding, so a stale
 * delivery cannot continue.
 *
 * Called by: the agent-controller composition when it starts the artifact preprocessing handler.
 *
 * @param options - Same-silo origin, projected-token path, request timeout, and test seams.
 * @returns The controller authority that claims and binds one PDF preprocessing Job.
 * @throws Error when the configured origin, token path, or timeout cannot meet the private-route boundary.
 * @see __CreateControllerExchange for the shared transport boundary.
 */
export function __CreateHttpArtifactPreprocessControllerAuthority(options: ControllerExchangeOptions): ArtifactPreprocessControllerAuthority
{
	const transport = __CreateControllerExchange("artifact preprocessing", options);

	return {
		async claimForTask(preprocessJobId: string, task: IWorkflowTaskReceipt): Promise<ArtifactPreprocessControllerRecord | null>
		{
			const acceptedPreprocessJobId = __RequireControllerRouteId(preprocessJobId, "artifact preprocessing job id");
			return await ___DoWithTrace("agent_controller.artifact_preprocess.claim", { preprocessJobId: acceptedPreprocessJobId }, async function _Claim(): Promise<ArtifactPreprocessControllerRecord | null>
			{
				return await transport.exchange({ path: _Route(acceptedPreprocessJobId, "claim"), method: "POST", body: task, conflict: null, failure: "artifact preprocessing claim", parse: function _Validate(value: unknown): ArtifactPreprocessControllerRecord { return _ParseArtifactPreprocessControllerRecord(value, acceptedPreprocessJobId); } });
			});
		},
		async bindWorkload(preprocessJobId: string, task: IWorkflowTaskReceipt, command: ArtifactPreprocessWorkloadBindCommand): Promise<"bound" | "idempotent" | "conflict">
		{
			const acceptedPreprocessJobId = __RequireControllerRouteId(preprocessJobId, "artifact preprocessing job id");
			return await ___DoWithTrace("agent_controller.artifact_preprocess.workload_binding", { preprocessJobId: acceptedPreprocessJobId, workloadUid: command.binding.workloadUid }, async function _BindWorkload(): Promise<"bound" | "idempotent" | "conflict">
			{
				return await transport.exchange({ path: _Route(acceptedPreprocessJobId, "workload-binding"), method: "PUT", body: { task, ...command }, conflict: "conflict" as const, failure: "artifact preprocessing workload binding", parse: function _Validate(value: unknown): "bound" | "idempotent" { return _ParseArtifactPreprocessBindOutcome(value, acceptedPreprocessJobId); } });
			});
		},
		async bindFirstPod(preprocessJobId: string, task: IWorkflowTaskReceipt, command: ArtifactPreprocessPodBindCommand): Promise<"bound" | "idempotent" | "conflict">
		{
			const acceptedPreprocessJobId = __RequireControllerRouteId(preprocessJobId, "artifact preprocessing job id");
			return await ___DoWithTrace("agent_controller.artifact_preprocess.pod_binding", { preprocessJobId: acceptedPreprocessJobId, podUid: command.binding.firstPodUid }, async function _BindFirstPod(): Promise<"bound" | "idempotent" | "conflict">
			{
				return await transport.exchange({ path: _Route(acceptedPreprocessJobId, "pod-binding"), method: "PUT", body: { task, ...command }, conflict: "conflict" as const, failure: "artifact preprocessing Pod binding", parse: function _Validate(value: unknown): "bound" | "idempotent" { return _ParseArtifactPreprocessBindOutcome(value, acceptedPreprocessJobId); } });
			});
		},
		async loadOutcome(preprocessJobId: string, deliveryCount: number, task: IWorkflowTaskReceipt): Promise<ArtifactPreprocessOutcome | null>
		{
			const acceptedPreprocessJobId = __RequireControllerRouteId(preprocessJobId, "artifact preprocessing job id");
			return await ___DoWithTrace("agent_controller.artifact_preprocess.outcome_load", { preprocessJobId: acceptedPreprocessJobId, deliveryCount }, async function _LoadOutcome(): Promise<ArtifactPreprocessOutcome | null>
			{
				return await transport.exchange({ path: _Route(acceptedPreprocessJobId, "outcome/load"), method: "POST", body: { task, deliveryCount }, conflict: null, failure: "artifact preprocessing outcome load", parse: function _Validate(value: unknown): ArtifactPreprocessOutcome { return _ParseArtifactPreprocessOutcome(value, acceptedPreprocessJobId, deliveryCount); } });
			});
		},
		async recordUnreportedFailure(preprocessJobId: string, task: IWorkflowTaskReceipt, command: ArtifactPreprocessRecoveryCommand): Promise<ArtifactPreprocessOutcome | null>
		{
			const acceptedPreprocessJobId = __RequireControllerRouteId(preprocessJobId, "artifact preprocessing job id");
			return await ___DoWithTrace("agent_controller.artifact_preprocess.recovery_failure", { preprocessJobId: acceptedPreprocessJobId, deliveryCount: command.binding.deliveryCount, reason: command.reason }, async function _RecordRecoveryFailure(): Promise<ArtifactPreprocessOutcome | null>
			{
				return await transport.exchange({ path: _Route(acceptedPreprocessJobId, "recovery/failure"), method: "POST", body: { task, ...command }, conflict: null, failure: "artifact preprocessing recovery failure write", parse: function _Validate(value: unknown): ArtifactPreprocessOutcome { return _ParseArtifactPreprocessOutcome(value, acceptedPreprocessJobId, command.binding.deliveryCount); } });
			});
		},
		async complete(preprocessJobId: string, completion: ArtifactPreprocessCompletion, task: IWorkflowTaskReceipt): Promise<"completed" | "idempotent" | "conflict">
		{
			const acceptedPreprocessJobId = __RequireControllerRouteId(preprocessJobId, "artifact preprocessing job id");
			return await ___DoWithTrace("agent_controller.artifact_preprocess.completion_complete", { preprocessJobId: acceptedPreprocessJobId }, async function _Complete(): Promise<"completed" | "idempotent" | "conflict">
			{
				const outcome = await transport.exchange({ path: _Route(acceptedPreprocessJobId, "completion/complete"), method: "POST", body: { task, completion }, conflict: "conflict" as const, failure: "artifact preprocessing completion write", parse: function _Validate(value: unknown): "bound" | "idempotent" { return _ParseArtifactPreprocessBindOutcome(value, acceptedPreprocessJobId); } });
				if (outcome === "conflict")
				{
					return "conflict";
				}
				return outcome === "bound" ? "completed" : "idempotent";
			});
		},
	};
}
