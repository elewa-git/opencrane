import { isDeepStrictEqual } from "node:util";

import type { V1Job, V1ObjectMeta } from "@kubernetes/client-node";

const _SERVER_METADATA_FIELDS = ["creationTimestamp", "generation", "managedFields", "resourceVersion", "selfLink", "uid"] as const;

function _OwnedMetadata(metadata: V1ObjectMeta | undefined): V1ObjectMeta
{
	const owned = structuredClone(metadata ?? {});
	for (const field of _SERVER_METADATA_FIELDS) delete (owned as Record<string, unknown>)[field];
	return owned;
}

function _DeleteDefault(record: Record<string, unknown>, key: string, expected: unknown): void
{
	if (key in record && isDeepStrictEqual(record[key], expected)) delete record[key];
}

function _RemoveGeneratedJobSelectors(job: Record<string, unknown>): void
{
	const metadata = job.metadata as Record<string, unknown> | undefined;
	const spec = job.spec as Record<string, unknown> | undefined;
	const template = spec?.template as Record<string, unknown> | undefined;
	const labels = (template?.metadata as Record<string, unknown> | undefined)?.labels as Record<string, unknown> | undefined;
	const selector = spec?.selector as Record<string, unknown> | undefined;
	const matchLabels = selector?.matchLabels as Record<string, unknown> | undefined;
	const uid = metadata?.uid;
	const name = metadata?.name;
	if (!selector) return;
	if (!spec || !labels || !matchLabels || typeof uid !== "string" || typeof name !== "string") throw new Error("refusing to adopt a Job with incomplete Kubernetes ownership selectors");
	const expectedLabels = { "batch.kubernetes.io/controller-uid": uid, "batch.kubernetes.io/job-name": name, "controller-uid": uid, "job-name": name };
	for (const [key, value] of Object.entries(expectedLabels))
	{
		if (matchLabels[key] !== value || labels[key] !== value) throw new Error("refusing to adopt a Job with mismatched Kubernetes ownership selectors");
		delete labels[key];
	}
	if (!isDeepStrictEqual(matchLabels, expectedLabels)) throw new Error("refusing to adopt a Job with unexpected Kubernetes ownership selectors");
	delete spec.selector;
}

function _NormalizedJob(job: V1Job): Record<string, unknown>
{
	const normalized = structuredClone(job) as unknown as Record<string, unknown>;
	delete normalized.status;
	_RemoveGeneratedJobSelectors(normalized);
	normalized.metadata = _OwnedMetadata(job.metadata) as unknown as Record<string, unknown>;
	const spec = normalized.spec as Record<string, unknown>;
	_DeleteDefault(spec, "manualSelector", false);
	_DeleteDefault(spec, "completionMode", "NonIndexed");
	_DeleteDefault(spec, "podReplacementPolicy", "TerminatingOrFailed");
	const podSpec = (spec.template as Record<string, unknown>).spec as Record<string, unknown>;
	_DeleteDefault(podSpec, "serviceAccount", podSpec.serviceAccountName);
	_DeleteDefault(podSpec, "dnsPolicy", "ClusterFirst");
	_DeleteDefault(podSpec, "schedulerName", "default-scheduler");
	_DeleteDefault(podSpec, "terminationGracePeriodSeconds", 30);
	for (const container of podSpec.containers as Array<Record<string, unknown>>)
	{
		_DeleteDefault(container, "terminationMessagePath", "/dev/termination-log");
		_DeleteDefault(container, "terminationMessagePolicy", "File");
	}
	return normalized;
}

/**
 * Throw unless the Job in the cluster is still suspended and matches the Job we would have created.
 *
 * Comparison ignores the fields Kubernetes owns rather than us — UID, resource version, generation,
 * creation timestamp, managed fields, self link, the generated owner selectors, and defaults the
 * API server fills in — so an unchanged Job compares equal even though the server added to it.
 * Everything else must be identical.
 *
 * Called by: the Job-ensure path in kubernetes-agent-controller-store.ts, on both the created
 * object and the object read back after an AlreadyExists reply.
 * @param current - The Job as Kubernetes holds it.
 * @param expected - The Job this attempt should have.
 * @throws When the Job is not suspended, when its generated owner selectors are missing or wrong,
 * or when any field we own differs. The caller must not repair it: a mismatch means OpenCrane and
 * the cluster disagree, and repairing would hide that.
 * @see {@link _AssertExactAssignedAgentRuntimeJob}
 */
export function _AssertExactSuspendedAgentRuntimeJob(current: V1Job, expected: V1Job): void
{
	if (current.spec?.suspend !== true || !isDeepStrictEqual(_NormalizedJob(current), _NormalizedJob(expected))) throw new Error("refusing to adopt a Job that differs from the claimed suspended runtime attempt");
}

/**
 * Throw unless the Job in the cluster is still the one the recorded assignment points at.
 *
 * Same field-by-field comparison as the suspended check, with two allowances for a Job that has
 * already been released: its suspend flag may be either value, and its deadline may be lower than
 * the profile's, because release deliberately shortens it to fit the assignment. A deadline higher
 * than the profile's, or a UID other than the recorded one, is always refused.
 *
 * Called by: the release path in kubernetes-agent-controller-store.ts, both before patching and on
 * the object Kubernetes returns afterwards.
 * @param current - The Job as Kubernetes holds it.
 * @param expected - The Job rebuilt from the recorded coordinates, carrying the profile deadline.
 * @param workloadUid - UID recorded at assignment; the Job's UID must equal it.
 * @throws When the UID differs, when suspend is neither true nor false, when the released deadline
 * is not a positive integer at or below the profile's, or when any other owned field differs.
 * @see {@link _AssertExactSuspendedAgentRuntimeJob}
 */
export function _AssertExactAssignedAgentRuntimeJob(current: V1Job, expected: V1Job, workloadUid: string): void
{
	if (current.metadata?.uid !== workloadUid || (current.spec?.suspend !== true && current.spec?.suspend !== false)) throw new Error("refusing to adopt a Job outside the exact durable workload assignment");
	const expectedAtCurrentReleaseState = structuredClone(expected);
	if (!expectedAtCurrentReleaseState.spec) throw new Error("expected runtime Job is missing its owned specification");
	expectedAtCurrentReleaseState.spec.suspend = current.spec.suspend;
	if (current.spec.suspend === false)
	{
		const currentDeadline = current.spec.activeDeadlineSeconds;
		const maximumDeadline = expected.spec?.activeDeadlineSeconds;
		if (!Number.isSafeInteger(currentDeadline) || currentDeadline! < 1 || !Number.isSafeInteger(maximumDeadline) || currentDeadline! > maximumDeadline!) throw new Error("refusing to adopt a released Job outside its bounded assignment deadline");
		expectedAtCurrentReleaseState.spec.activeDeadlineSeconds = currentDeadline;
	}
	if (!isDeepStrictEqual(_NormalizedJob(current), _NormalizedJob(expectedAtCurrentReleaseState))) throw new Error("refusing to adopt a Job that differs from the assigned runtime workload");
}
