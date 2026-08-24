import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { tmpdir } from "node:os";

import type { V1Job } from "@kubernetes/client-node";

import type { AgentControllerWorkloadStore } from "./agent-controller.types";
import { _AssertExactAssignedAgentRuntimeJob, _AssertExactSuspendedAgentRuntimeJob } from "./kubernetes-agent-job-adoption";
import { _AssertExactFirstAgentRuntimePod } from "./kubernetes-runtime-pod";
import { _CreateLocalAgentRuntimeFiles, _EnsureLocalAgentRuntimeAttemptKey } from "./local-agent-runtime-files";
import { _ReleaseLocalAgentRuntimeAttempt, _StopLocalAgentRuntimeAttempt } from "./local-agent-runtime-process";
import { LocalAgentRuntimeModelStrategies, type LocalAgentRuntimeAttempt, type LocalProcessAgentControllerStoreOptions } from "./local-process-agent-controller-store.types";

/** Return the deterministic name carried by one expected Job. */
function _JobName(job: V1Job): string
{
	const name = job.metadata?.name;

	if (!name)
	{
		throw new Error("local agent runtime requires a deterministic Job name");
	}

	return name;
}

/** Resolve the local attempt owned by the exact expected Job and workload UID. */
function _AttemptForRelease(attempts: ReadonlyMap<string, LocalAgentRuntimeAttempt>, expected: V1Job, workloadUid: string): LocalAgentRuntimeAttempt
{
	const attempt = attempts.get(_JobName(expected));

	if (!attempt || attempt.workloadUid !== workloadUid)
	{
		throw new Error("local agent runtime release does not match a prepared workload");
	}

	_AssertExactAssignedAgentRuntimeJob(attempt.job, expected, workloadUid);
	return attempt;
}

/**
 * Create a development-only replacement for the Kubernetes runtime Job host.
 *
 * The adapter keeps the existing controller authority, assignment commit, release claim, first-Pod
 * registration, bootstrap, command stream, and candidate pipeline. It replaces only suspended Job
 * projection with a local child process. Each attempt receives private bootstrap and runtime-token
 * files. Real-model profiles also receive a private attempt-key file, while simulated profiles
 * receive neither a model endpoint nor a model-key file.
 *
 * Called by: `apps/agent-controller/src/development/index.ts`.
 * @param options - Local runtime location, endpoints, token source, model strategy, and shutdown.
 * @returns The existing controller's Kubernetes-shaped port implemented by local process state.
 * @throws When paths or endpoints are not valid for an explicit local development composition.
 */
export function __CreateLocalProcessAgentControllerStore(options: LocalProcessAgentControllerStoreOptions): AgentControllerWorkloadStore
{
	const runtimeUrl = URL.parse(options.runtimeStreamUrl);
	const litellmUrl = options.litellmBaseUrl ? URL.parse(options.litellmBaseUrl) : null;
	const usesLiteLlm = options.modelStrategy === LocalAgentRuntimeModelStrategies.LiteLlm;

	if (!isAbsolute(options.runtimeApplicationDirectory) || !isAbsolute(options.runtimeLaunchSecretPath) || !runtimeUrl || !["http:", "https:"].includes(runtimeUrl.protocol) || (usesLiteLlm && (!litellmUrl || !["http:", "https:"].includes(litellmUrl.protocol))) || (!usesLiteLlm && options.litellmBaseUrl))
	{
		throw new Error("local agent runtime requires absolute paths and strategy-matched HTTP(S) endpoints");
	}

	const attempts = new Map<string, LocalAgentRuntimeAttempt>();
	const temporaryDirectoryRoot = options.temporaryDirectoryRoot ?? tmpdir();
	options.shutdownSignal.addEventListener("abort", function _StopLocalAttempts(): void
	{
		for (const attempt of attempts.values())
		{
			void _StopLocalAgentRuntimeAttempt(attempt);
		}
	}, { once: true });

	return {
		async __EnsureSuspendedJob(expected)
		{
			const name = _JobName(expected);
			const current = attempts.get(name);

			if (current)
			{
				_AssertExactSuspendedAgentRuntimeJob(current.job, expected);
				return structuredClone(current.job);
			}

			const files = await _CreateLocalAgentRuntimeFiles(expected, temporaryDirectoryRoot);
			const workloadUid = randomUUID();
			const job: V1Job = {
				...structuredClone(expected),
				metadata: {
					...structuredClone(expected.metadata),
					uid: workloadUid,
					resourceVersion: "1"
				}
			};
			attempts.set(name, {
				job,
				workloadUid,
				files
			});
			return structuredClone(job);
		},
		async __EnsureAttemptKeySecret(expected)
		{
			if (!usesLiteLlm)
			{
				return;
			}

			const workloadUid = expected.metadata?.ownerReferences?.[0]?.uid;
			const attempt = [...attempts.values()].find(candidate => candidate.workloadUid === workloadUid);

			if (!attempt)
			{
				throw new Error("local agent runtime key does not match a prepared workload");
			}

			await _EnsureLocalAgentRuntimeAttemptKey(attempt.files, expected);
		},
		async __EnsureRuntimeJobReleased(expected, workloadUid, assignmentExpiresAt, releaseLeaseExpiresAt)
		{
			const attempt = _AttemptForRelease(attempts, expected, workloadUid);
			return _ReleaseLocalAgentRuntimeAttempt(options, attempt, expected, assignmentExpiresAt, releaseLeaseExpiresAt);
		},
		async __FindFirstRuntimePod(expected, workloadUid, serviceAccountName)
		{
			const attempt = _AttemptForRelease(attempts, expected, workloadUid);

			if (!attempt.pod)
			{
				return null;
			}

			_AssertExactFirstAgentRuntimePod(attempt.pod, expected, workloadUid, serviceAccountName);
			return structuredClone(attempt.pod);
		}
	};
}
