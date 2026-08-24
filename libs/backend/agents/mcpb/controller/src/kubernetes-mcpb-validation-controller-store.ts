import { isDeepStrictEqual } from "node:util";

import { Observable, type ConfigurationOptions, type ObservableMiddleware, type RequestContext, type ResponseContext, type V1Job, type V1ObjectMeta } from "@kubernetes/client-node";

import type { McpbValidationControllerKubernetesStore, McpbValidationControllerKubernetesStoreOptions } from "./mcpb-validation-controller.types";

/** Kubernetes-generated metadata that does not belong to the controller's expected Job manifest. */
const _SERVER_METADATA_FIELDS = ["creationTimestamp", "generation", "managedFields", "resourceVersion", "selfLink", "uid"] as const;

/** Add shutdown and timeout cancellation to one Kubernetes client request. */
function _RequestOptions(shutdownSignal: AbortSignal, timeoutMilliseconds: number): ConfigurationOptions
{
	const signal = AbortSignal.any([shutdownSignal, AbortSignal.timeout(timeoutMilliseconds)]);
	const middleware: ObservableMiddleware = {
		pre(context: RequestContext): Observable<RequestContext>
		{
			context.setSignal(signal);
			return new Observable(Promise.resolve(context));
		},
		post(context: ResponseContext): Observable<ResponseContext>
		{
			return new Observable(Promise.resolve(context));
		},
	};
	return { middleware: [middleware], middlewareMergeStrategy: "append" };
}

/** Return a Kubernetes HTTP status carried by an API client error. */
function _StatusCode(err: unknown): number | undefined
{
	if (typeof err !== "object" || err === null)
	{
		return undefined;
	}
	const record = err as Record<string, unknown>;
	if (typeof record.statusCode === "number")
	{
		return record.statusCode;
	}
	if (typeof record.code === "number")
	{
		return record.code;
	}
	return undefined;
}

/** Read the deterministic name and namespace required by the Kubernetes Job calls. */
function _Coordinates(job: V1Job): { readonly name: string; readonly namespace: string }
{
	const name = job.metadata?.name;
	const namespace = job.metadata?.namespace;
	if (!name || !namespace)
	{
		throw new Error("MCP bundle validator Job requires deterministic namespaced metadata");
	}
	return { name, namespace };
}

/** Remove Kubernetes-managed metadata before comparing a current Job with its fixed manifest. */
function _OwnedMetadata(metadata: V1ObjectMeta | undefined): V1ObjectMeta
{
	const result = structuredClone(metadata ?? {});
	for (const field of _SERVER_METADATA_FIELDS)
	{
		delete (result as Record<string, unknown>)[field];
	}
	return result;
}

/** Remove Kubernetes defaults and generated selectors before comparing exact Job manifests. */
function _NormalizedJob(job: V1Job): Record<string, unknown>
{
	const result = structuredClone(job) as unknown as Record<string, unknown>;
	delete result.status;
	result.metadata = _OwnedMetadata(job.metadata) as unknown as Record<string, unknown>;
	const spec = result.spec as Record<string, unknown>;
	delete spec.selector;
	if (spec.manualSelector === false)
	{
		delete spec.manualSelector;
	}
	if (spec.completionMode === "NonIndexed")
	{
		delete spec.completionMode;
	}
	const podSpec = ((spec.template as Record<string, unknown>).spec as Record<string, unknown>);
	if (podSpec.serviceAccount === podSpec.serviceAccountName)
	{
		delete podSpec.serviceAccount;
	}
	if (podSpec.dnsPolicy === "ClusterFirst")
	{
		delete podSpec.dnsPolicy;
	}
	if (podSpec.schedulerName === "default-scheduler")
	{
		delete podSpec.schedulerName;
	}
	if (podSpec.terminationGracePeriodSeconds === 30)
	{
		delete podSpec.terminationGracePeriodSeconds;
	}
	return result;
}

/** Reject any Job that differs from the one the restricted builder produced. */
function _AssertExactSuspendedJob(current: V1Job, expected: V1Job): void
{
	if (current.spec?.suspend !== true || !current.metadata?.uid || !isDeepStrictEqual(_NormalizedJob(current), _NormalizedJob(expected)))
	{
		throw new Error("refusing to adopt a Job that differs from the claimed suspended MCP bundle validator workload");
	}
}

/** Create the Kubernetes adapter that may create or exactly adopt suspended MCP bundle validator Jobs. */
export function __CreateKubernetesMcpbValidationControllerStore(options: McpbValidationControllerKubernetesStoreOptions): McpbValidationControllerKubernetesStore
{
	if (!Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 60_000)
	{
		throw new Error("MCP bundle validation Kubernetes store requires a 1-60s request timeout");
	}
	return {
		async __EnsureSuspendedJob(expected: V1Job): Promise<V1Job>
		{
			const { name, namespace } = _Coordinates(expected);
			try
			{
				const created = await options.batchApi.createNamespacedJob({ namespace, body: expected }, _RequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				_AssertExactSuspendedJob(created, expected);
				return created;
			}
			catch (err)
			{
				if (_StatusCode(err) !== 409)
				{
					throw err;
				}
				const existing = await options.batchApi.readNamespacedJob({ namespace, name }, _RequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				_AssertExactSuspendedJob(existing, expected);
				return existing;
			}
		},
	};
}
