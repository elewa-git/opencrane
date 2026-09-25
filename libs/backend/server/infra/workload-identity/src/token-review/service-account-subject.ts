import type { RuntimeWorkloadIdentity } from "./workload-identity.types";

/** Read the Pod UID Kubernetes attaches to a bound projected ServiceAccount token. */
export function _ReadReviewedPodUid(extra: Record<string, string[]> | undefined): string | null
{
	const podUid = extra?.["authentication.kubernetes.io/pod-uid"]?.[0];
	return typeof podUid === "string" && podUid.length > 0 ? podUid : null;
}

/** Parse a Kubernetes ServiceAccount username into bounded namespace and account coordinates. */
function _ParseServiceAccountSubject(username: string): { readonly namespace: string; readonly serviceAccountName: string } | null
{
	const match = /^system:serviceaccount:([a-z0-9]([-a-z0-9]*[a-z0-9])?):([a-z0-9]([-a-z0-9]*[a-z0-9])?)$/.exec(username);
	return match ? { namespace: match[1]!, serviceAccountName: match[3]! } : null;
}

/** Return the runtime identity only when the subject parses, its namespace is the expected one, its ServiceAccount name passes the supplied name check, and the token carried a bound Pod UID. */
export function _ParseRuntimeSubject(subject: string, expectedNamespace: string, podUid: string | null, isServiceAccountName: (value: string) => boolean): RuntimeWorkloadIdentity | null
{
	const parsed = _ParseServiceAccountSubject(subject);
	if (!parsed || parsed.namespace !== expectedNamespace || !isServiceAccountName(parsed.serviceAccountName) || !podUid)
		return null;
	return { subject, ...parsed, podUid };
}
