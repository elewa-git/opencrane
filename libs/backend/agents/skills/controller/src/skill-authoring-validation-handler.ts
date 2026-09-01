import type { V1Job, V1Pod } from "@kubernetes/client-node";

import { SkillAuthoringValidationTaskDeclaration } from "@opencrane/backend/agents/skills/workflows/contract";
import type { SkillAuthoringValidationCurrentStatus, SkillAuthoringValidationTaskInput } from "@opencrane/backend/agents/skills/workflows/contract";
import { __BuildSkillAuthoringValidationJob } from "@opencrane/backend/agents/skills/k8s-launcher";
import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import type { RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";
import type { GovernedJobObservation } from "@opencrane/backend/agents/runtime/workloads/k8s-controller";
import { SkillAuthoringValidationRecoveryReasons } from "@opencrane/backend/agents/skills/workflows/contract";
import { __CreateSkillAuthoringValidationBootstrapReference } from "@opencrane/contracts";
import { WorkflowTaskTerminalError, ___DeliveryCheckpointName, ___SleepWithinClaim } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";

import type { SkillAuthoringValidationCompletion, SkillAuthoringValidationControllerRecord, SkillAuthoringValidationHandlerOptions, SkillAuthoringValidationTaskContext, SkillAuthoringValidationTaskResult } from "./skill-authoring-validation-handler.types";

/** Reports a live Job whose first Pod is not visible yet without saving null in a checkpoint. */
class _SkillAuthoringPodNotReadyError extends Error {}

/** Reports a live Job whose worker completion is not visible yet. */
class _SkillAuthoringCompletionNotReadyError extends Error {}

/** Restarts the task-owned delivery loop after the server-issued workload lease expires. */
class _SkillAuthoringClaimExpiredError extends Error {}

/** Restarts recovery when database time says the saved claim has not expired yet. */
class _SkillAuthoringDatabaseExpiryNotReadyError extends Error {}

/** Fixed recovery heartbeat for a Job whose worker may stop before reporting. */
const _RECOVERY_HEARTBEAT_MILLISECONDS = 1_000;

/** Bounds server-claim renewal to the task's reviewed attempt budget. */
const _MAX_DELIVERY_CYCLES = SkillAuthoringValidationTaskDeclaration.retryPolicy.maximumAttempts;

/** Maps terminal Kubernetes observations to stable task-owned failure reasons. */
const _RECOVERY_REASON_BY_OBSERVATION: Readonly<Record<Exclude<GovernedJobObservation, "running">, SkillAuthoringValidationRecoveryReasons>> = {
	missing: SkillAuthoringValidationRecoveryReasons.JobMissingWithoutCompletion,
	terminal: SkillAuthoringValidationRecoveryReasons.JobTerminalWithoutCompletion,
};

/** Require the immutable Kubernetes UID that the server must record before the authoring Job is released. */
function _JobUid(job: V1Job): string
{
	const uid = job.metadata?.uid?.trim();
	if (!uid)
	{
		throw new Error("Kubernetes did not return an immutable UID for the authoring validation Job");
	}
	return uid;
}

/** Require the immutable Kubernetes UID of the first Job-owned Pod before the server records it. */
function _PodUid(pod: V1Pod): string
{
	const uid = pod.metadata?.uid?.trim();
	if (!uid)
	{
		throw new Error("Kubernetes did not return an immutable UID for the authoring validation Pod");
	}
	return uid;
}

/**
 * Builds the authoring Job without artifact bytes, task input, or credentials.
 *
 * The server retains those values and the worker must use the bootstrap reference after the server
 * has recorded the Job and first Pod identities.
 */
async function _Job(record: SkillAuthoringValidationControllerRecord, profile: SkillAuthoringValidationHandlerOptions["profile"]): Promise<{ readonly job: V1Job; readonly bootstrapReference: string }>
{
	const bootstrapReference = await __CreateSkillAuthoringValidationBootstrapReference(record.validationId);
	const job = __BuildSkillAuthoringValidationJob({ jobId: record.jobId, siloId: record.siloId, namespace: profile.namespace, capabilityReference: bootstrapReference }, profile);
	return { job, bootstrapReference };
}

/** Saves one task-owned failure and deletes only the Job UID already bound by the server. */
async function _FailAndDelete(options: SkillAuthoringValidationHandlerOptions, context: SkillAuthoringValidationTaskContext, record: SkillAuthoringValidationControllerRecord, preparedJob: V1Job, binding: RuntimeWorkloadBinding, reason: SkillAuthoringValidationRecoveryReasons, step: string): Promise<never>
{
	const outcome = await options.authority.failUnreported(record.validationId, context.task, binding, reason);
	if (outcome === "not_expired")
	{
		await context.sleepUntil(new Date(Date.now() + _RECOVERY_HEARTBEAT_MILLISECONDS), `${step}:wait-for-database-expiry`);
		throw new _SkillAuthoringDatabaseExpiryNotReadyError();
	}
	if (outcome === "conflict")
	{
		const completion = await options.authority.loadCurrentCompletion(record.validationId, context.task);
		const status = await options.authority.loadCurrentStatus(record.validationId, context.task);
		if (completion !== null || status === "cancelled" || status === "completed")
			return await _DeleteInactiveJob(options, context, preparedJob, binding, `${step}:terminal-race`);
		throw new WorkflowTaskTerminalError("Skill authoring validation recovery no longer matches its saved Job.");
	}
	await context.checkpoint({ stepName: `${step}:delete-job` }, async function _DeleteJob(): Promise<void> { await options.kubernetes.deleteJob(preparedJob, binding.workloadUid); });
	throw new WorkflowTaskTerminalError("Skill authoring validation Job ended without a worker completion.");
}

/** Lets a durable worker completion win the race against task-owned Job recovery. */
async function _FailAfterPodOrLoadCompletion(options: SkillAuthoringValidationHandlerOptions, context: SkillAuthoringValidationTaskContext, record: SkillAuthoringValidationControllerRecord, preparedJob: V1Job, binding: RuntimeWorkloadBinding, reason: SkillAuthoringValidationRecoveryReasons, step: string): Promise<SkillAuthoringValidationCompletion>
{
	const outcome = await options.authority.failUnreported(record.validationId, context.task, binding, reason);
	if (outcome === "not_expired")
	{
		await context.sleepUntil(new Date(Date.now() + _RECOVERY_HEARTBEAT_MILLISECONDS), `${step}:wait-for-database-expiry`);
		throw new _SkillAuthoringDatabaseExpiryNotReadyError();
	}
	if (outcome === "conflict")
	{
		const completion = await options.authority.loadCurrentCompletion(record.validationId, context.task);
		if (completion !== null)
		{
			return completion;
		}
		const status = await options.authority.loadCurrentStatus(record.validationId, context.task);
		if (status === "cancelled" || status === "completed")
		{
			return await _DeleteInactiveJob(options, context, preparedJob, binding, `${step}:terminal-race`);
		}
		throw new WorkflowTaskTerminalError("Skill authoring validation recovery no longer matches its saved Job.");
	}
	await context.checkpoint({ stepName: `${step}:delete-job` }, async function _DeleteJob(): Promise<void> { await options.kubernetes.deleteJob(preparedJob, binding.workloadUid); });
	throw new WorkflowTaskTerminalError("Skill authoring validation Job ended without a worker completion.");
}

/** Deletes the exact bound Job after the server reports that its validation is no longer active. */
async function _DeleteInactiveJob(options: SkillAuthoringValidationHandlerOptions, context: SkillAuthoringValidationTaskContext, preparedJob: V1Job, binding: RuntimeWorkloadBinding, step: string): Promise<never>
{
	await context.checkpoint({ stepName: `${step}:delete-job` }, async function _DeleteJob(): Promise<void> { await options.kubernetes.deleteJob(preparedJob, binding.workloadUid); });
	throw new WorkflowTaskTerminalError("Skill authoring validation is no longer active.");
}

/**
 * Registers the remote task that creates, releases, observes, and completes one Python authoring Job.
 *
 * It uses the declaration the server already admitted, claims and binds the Job UID before release,
 * then binds the first Pod before it accepts a server-persisted completion. The server remains the
 * terminal writer, so the controller never writes product state directly.
 *
 * @param options - Supplies the server authority, Kubernetes adapter, deployment profile, and Pod delay.
 * @returns A replay-safe workflow definition for one admitted validation.
 * @throws {WorkflowTaskTerminalError} When the saved validation, selected profile, or completion inbox cannot be used.
 * @see SkillAuthoringValidationTaskDeclaration — supplies the task name and retry policy shared with the server.
 */
export function __CreateSkillAuthoringValidationHandler(options: SkillAuthoringValidationHandlerOptions): IWorkflowTaskDefinition<SkillAuthoringValidationTaskInput, SkillAuthoringValidationTaskResult>
{
	return {
		...SkillAuthoringValidationTaskDeclaration,
		async run(context, input): Promise<SkillAuthoringValidationTaskResult>
		{
			let cycle = 1;
			let pod: V1Pod | null = null;
			let record: SkillAuthoringValidationControllerRecord | null = null;
			let prepared: Awaited<ReturnType<typeof _Job>> | null = null;
			let workloadBinding: RuntimeWorkloadBinding | null = null;
			let workloadBound = false;
			let unboundJobUid: string | null = null;
			while (pod === null || record === null || prepared === null || workloadBinding === null)
			{
				try
				{
					// 1. Ask the server for this delivery's claim, so replay cannot select another validation or silo.
					record = await context.checkpoint({ stepName: ___DeliveryCheckpointName(cycle, "claim-validation") }, async function _ClaimValidation(): Promise<SkillAuthoringValidationControllerRecord>
					{
						const loaded = await options.authority.claimForTask(input.validationId, context.task);
						if (loaded === null || loaded.siloId !== input.siloId || loaded.claim.workloadClass !== RuntimeWorkloadClaimClasses.SkillAuthoringValidation || loaded.claim.profileName !== "authoring")
						{
							throw new WorkflowTaskTerminalError("Skill authoring validation is no longer available.");
						}
						return loaded;
					});
					const claimExpiry = new Date(record.claim.expiresAt).getTime();
					if (!Number.isSafeInteger(claimExpiry))
						throw new WorkflowTaskTerminalError("Skill authoring validation claim has no usable expiry.");

					// 2. Create or adopt the deterministic suspended Job, then bind its UID before Python can run.
					prepared = await _Job(record, options.profile);
					const assigned = await context.checkpoint({ stepName: ___DeliveryCheckpointName(cycle, "ensure-suspended-job") }, async function _EnsureSuspendedJob(): Promise<V1Job>
					{
						return await options.kubernetes.ensureSuspendedJob(prepared!.job);
					});
					const jobUid = _JobUid(assigned);
					unboundJobUid = jobUid;
					workloadBinding = { claimId: record.claim.claimId, claimedAt: record.claim.claimedAt, deliveryCount: record.claim.deliveryCount, profileName: record.claim.profileName, workloadUid: jobUid };
					const workloadOutcome = await context.checkpoint({ stepName: ___DeliveryCheckpointName(cycle, "bind-workload") }, async function _BindWorkload(): Promise<"bound" | "idempotent" | "inactive">
					{
						const outcome = await options.authority.bindWorkload(record!.validationId, context.task, { binding: workloadBinding!, bootstrapReference: prepared!.bootstrapReference, namespace: options.profile.namespace });
						if (outcome === "expired")
							throw new _SkillAuthoringClaimExpiredError();
						if (outcome === "conflict")
						{
							const status = await options.authority.loadCurrentStatus(record!.validationId, context.task);
							if (status === "cancelled" || status === "completed")
								return "inactive";
							throw new WorkflowTaskTerminalError("Skill authoring validation workload claim no longer matches.");
						}
						return outcome;
					});
					if (workloadOutcome === "inactive")
						return await _DeleteInactiveJob(options, context, prepared.job, workloadBinding, ___DeliveryCheckpointName(cycle, "workload-bind-inactive"));
					workloadBound = true;
					unboundJobUid = null;

					// 3. Release only the UID the server recorded, then wait until Kubernetes exposes its sole worker Pod.
					const releaseOutcome = await context.checkpoint({ stepName: ___DeliveryCheckpointName(cycle, "release-job") }, async function _ReleaseJob(): Promise<"released" | "inactive">
					{
						const authorization = await options.authority.authorizeRelease(record!.validationId, context.task, workloadBinding!);
						if (authorization === "expired")
							throw new _SkillAuthoringClaimExpiredError();
						if (authorization === "conflict")
						{
							const status = await options.authority.loadCurrentStatus(record!.validationId, context.task);
							if (status === "cancelled" || status === "completed")
								return "inactive";
							throw new WorkflowTaskTerminalError("Skill authoring validation release no longer matches its saved Job.");
						}
						await options.kubernetes.releaseJob(prepared!.job, jobUid, { lifetimeSeconds: authorization.releaseLifetimeSeconds });
						return "released";
					});
					if (releaseOutcome === "inactive")
						return await _DeleteInactiveJob(options, context, prepared.job, workloadBinding, ___DeliveryCheckpointName(cycle, "release-inactive"));
					let podObservation = 1;
					while (pod === null)
					{
						try
						{
							const observed = await context.checkpoint({ stepName: ___DeliveryCheckpointName(cycle, `find-first-pod-${podObservation}`) }, async function _FindFirstPod(): Promise<{ readonly pod: V1Pod } | { readonly reason: SkillAuthoringValidationRecoveryReasons } | { readonly inactive: SkillAuthoringValidationCurrentStatus }>
							{
								const status = await options.authority.loadCurrentStatus(record!.validationId, context.task);
								if (status !== "active")
									return { inactive: status };
								const firstPod = await options.kubernetes.findFirstPod(prepared!.job, jobUid, options.profile.serviceAccountName);
								if (firstPod !== null)
									return { pod: firstPod };
								if (Date.now() >= claimExpiry)
									return { reason: SkillAuthoringValidationRecoveryReasons.ClaimExpiredWithoutWorker };
								const jobObservation = await options.kubernetes.observeJob(prepared!.job, jobUid);
								if (jobObservation !== "running")
									return { reason: _RECOVERY_REASON_BY_OBSERVATION[jobObservation] };
								throw new _SkillAuthoringPodNotReadyError();
							});
							if ("inactive" in observed && observed.inactive === "conflict")
								throw new WorkflowTaskTerminalError("Skill authoring validation status no longer matches its task.");
							if ("inactive" in observed)
								return await _DeleteInactiveJob(options, context, prepared.job, workloadBinding, ___DeliveryCheckpointName(cycle, `pod-${podObservation}-inactive`));
							if ("reason" in observed)
								return await _FailAndDelete(options, context, record, prepared.job, workloadBinding, observed.reason, ___DeliveryCheckpointName(cycle, `pod-${podObservation}`));
							pod = observed.pod;
						}
						catch (error)
						{
							if (!(error instanceof _SkillAuthoringPodNotReadyError))
								throw error;
							await ___SleepWithinClaim(context, options.podWaitMilliseconds, claimExpiry, ___DeliveryCheckpointName(cycle, `wait-for-pod-${podObservation}`));
							podObservation += 1;
						}
					}
					const firstPodUid = _PodUid(pod);
					const podOutcome = await context.checkpoint({ stepName: ___DeliveryCheckpointName(cycle, "bind-first-pod") }, async function _BindFirstPod(): Promise<"bound" | "idempotent" | "inactive">
					{
						const outcome = await options.authority.bindFirstPod(record!.validationId, context.task, { binding: { ...workloadBinding!, firstPodUid } });
						if (outcome === "expired")
							throw new _SkillAuthoringClaimExpiredError();
						if (outcome === "conflict")
						{
							const status = await options.authority.loadCurrentStatus(record!.validationId, context.task);
							if (status === "cancelled" || status === "completed")
								return "inactive";
							throw new WorkflowTaskTerminalError("Skill authoring validation Pod claim no longer matches.");
						}
						return outcome;
					});
					if (podOutcome === "inactive")
						return await _DeleteInactiveJob(options, context, prepared.job, { ...workloadBinding, firstPodUid }, ___DeliveryCheckpointName(cycle, "pod-bind-inactive"));
				}
				catch (error)
				{
					if (error instanceof _SkillAuthoringDatabaseExpiryNotReadyError)
					{
						continue;
					}
					if (!(error instanceof _SkillAuthoringClaimExpiredError))
						throw error;
					if (workloadBound && record !== null && prepared !== null && workloadBinding !== null)
					{
						return await _FailAndDelete(options, context, record, prepared.job, workloadBinding, SkillAuthoringValidationRecoveryReasons.ClaimExpiredWithoutWorker, ___DeliveryCheckpointName(cycle, "bound-expiry"));
					}
					if (prepared !== null && unboundJobUid !== null)
					{
						const jobUid = unboundJobUid;
						await context.checkpoint({ stepName: ___DeliveryCheckpointName(cycle, "delete-unbound-expired-job") }, async function _DeleteUnboundExpiredJob(): Promise<void> { await options.kubernetes.deleteJob(prepared!.job, jobUid); });
					}
					if (record === null)
					{
						throw new WorkflowTaskTerminalError("Skill authoring validation expired without a saved claim.");
					}
					if (record.claim.deliveryCount >= _MAX_DELIVERY_CYCLES)
					{
						const outcome = await options.authority.failExpiredBeforeWorkload(record.validationId, context.task, record.claim);
						if (outcome === "not_expired")
						{
							await context.sleepUntil(new Date(Date.now() + _RECOVERY_HEARTBEAT_MILLISECONDS), ___DeliveryCheckpointName(cycle, "wait-for-database-expiry"));
							continue;
						}
						if (outcome === "conflict")
						{
							throw new WorkflowTaskTerminalError("Skill authoring validation final expired claim no longer matches.");
						}
						throw new WorkflowTaskTerminalError("Skill authoring validation claim expired before a workload was bound.");
					}
					cycle += 1;
					pod = null;
					record = null;
					prepared = null;
					workloadBinding = null;
					workloadBound = false;
					unboundJobUid = null;
				}
			}
			const boundPodUid = _PodUid(pod);

			// 4. Poll saved completion and exact Job state so a dead worker cannot suspend the task forever.
			let completion: SkillAuthoringValidationCompletion | null = null;
			let completionObservation = 1;
			while (completion === null)
			{
				try
				{
					const recovered = await context.checkpoint({ stepName: ___DeliveryCheckpointName(cycle, `recover-completion-${completionObservation}`) }, async function _RecoverCompletion(): Promise<{ readonly completion: SkillAuthoringValidationCompletion } | { readonly reason: SkillAuthoringValidationRecoveryReasons } | { readonly inactive: SkillAuthoringValidationCurrentStatus }>
					{
						const loaded = await options.authority.loadCurrentCompletion(record!.validationId, context.task);
						if (loaded !== null)
							return { completion: loaded };
						const status = await options.authority.loadCurrentStatus(record!.validationId, context.task);
						if (status !== "active")
							return { inactive: status };
						const observation = await options.kubernetes.observeJob(prepared!.job, workloadBinding!.workloadUid);
						if (observation === "running")
							throw new _SkillAuthoringCompletionNotReadyError();
						return { reason: _RECOVERY_REASON_BY_OBSERVATION[observation] };
					});
					if ("inactive" in recovered && recovered.inactive === "conflict")
						throw new WorkflowTaskTerminalError("Skill authoring validation status no longer matches its task.");
					if ("inactive" in recovered)
						return await _DeleteInactiveJob(options, context, prepared.job, { ...workloadBinding, firstPodUid: boundPodUid }, ___DeliveryCheckpointName(cycle, `completion-${completionObservation}-inactive`));
					if ("reason" in recovered)
						completion = await _FailAfterPodOrLoadCompletion(options, context, record, prepared.job, { ...workloadBinding, firstPodUid: boundPodUid }, recovered.reason, ___DeliveryCheckpointName(cycle, `completion-${completionObservation}`));
					else completion = recovered.completion;
				}
				catch (error)
				{
					if (!(error instanceof _SkillAuthoringCompletionNotReadyError))
						throw error;
					await context.sleepUntil(new Date(Date.now() + _RECOVERY_HEARTBEAT_MILLISECONDS), ___DeliveryCheckpointName(cycle, `wait-for-completion-${completionObservation}`));
					completionObservation += 1;
				}
			}
			const completionOutcome = await context.checkpoint({ stepName: ___DeliveryCheckpointName(cycle, "complete-validation") }, async function _CompleteValidation(): Promise<"completed" | "idempotent" | "inactive">
			{
				const outcome = await options.authority.complete(record!.validationId, completion, context.task);
				if (outcome === "conflict")
				{
					const status = await options.authority.loadCurrentStatus(record!.validationId, context.task);
					if (status === "cancelled" || status === "completed")
						return "inactive";
					throw new WorkflowTaskTerminalError("Skill authoring validation completion no longer matches.");
				}
				return outcome;
			});
			if (completionOutcome === "inactive")
				return await _DeleteInactiveJob(options, context, prepared.job, { ...workloadBinding, firstPodUid: boundPodUid }, ___DeliveryCheckpointName(cycle, "completion-write-inactive"));
			await context.checkpoint({ stepName: ___DeliveryCheckpointName(cycle, "delete-completed-job") }, async function _DeleteCompletedJob(): Promise<void> { await options.kubernetes.deleteJob(prepared!.job, workloadBinding!.workloadUid); });
			return { validationId: record.validationId, completionDigest: completion.completionDigest };
		},
	};
}
