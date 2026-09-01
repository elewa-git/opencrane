import type { Request, Response } from "express";

import type { AdmittedConversationComputerRuntime, ConversationComputerRuntimeAdmissionDependencies, ConversationComputerRuntimeIdentity } from "./conversation-computer-runtime-admission.types";

/**
 * Reviews a projected Sandbox token before a route can use a caller-selected computer identifier.
 *
 * A denial produces the uniform unauthorised response; a TokenReview transport failure is kept
 * distinct as unavailable so a Sandbox can retry without learning anything about computers.
 */
export async function _ReviewConversationComputerRuntimeIdentity(request: Request, response: Response, dependencies: ConversationComputerRuntimeAdmissionDependencies): Promise<ConversationComputerRuntimeIdentity | null>
{
	const token = _ReadBearer(request.header("authorization"));
	if (token === null)
	{
		response.status(401).json({ error: "runtime_denied" });
		return null;
	}
	try
	{
		const identity = await dependencies.tokenReviewer.__Review(token);
		if (identity === null)
			response.status(401).json({ error: "runtime_denied" });
		return identity;
	}
	catch (err)
	{
		dependencies.logger.error({ err }, "ConversationComputer runtime TokenReview failed");
		response.status(503).json({ error: "runtime_unavailable" });
		return null;
	}
}

/**
 * Derives an active execution and binds every reviewed Pod coordinate to the current lease.
 *
 * A replacement Pod has a different UID even if it uses the same namespace and ServiceAccount;
 * returning `null` prevents that replacement from reusing the former Pod's execution.
 */
export async function _AdmitConversationComputerRuntime(computerId: string, identity: ConversationComputerRuntimeIdentity, response: Response, dependencies: ConversationComputerRuntimeAdmissionDependencies): Promise<AdmittedConversationComputerRuntime | null>
{
	try
	{
		const active = await dependencies.history.loadActiveExecutionForBootstrap({ siloId: dependencies.siloId, computerId, nowEpochMilliseconds: dependencies.clock.now().getTime() });
		if (!_MatchesLeaseRuntimePod(identity, active.lease.runtimePod))
		{
			response.status(403).json({ error: "runtime_denied" });
			return null;
		}
		return { identity, active };
	}
	catch (err)
	{
		dependencies.logger.warn({ err }, "ConversationComputer runtime history was unavailable or inactive");
		response.status(403).json({ error: "runtime_denied" });
		return null;
	}
}

/** Reads one bearer token without accepting a token list or a scheme variation. */
function _ReadBearer(value: string | undefined): string | null
{
	const match = /^Bearer ([^\s,]+)$/u.exec(value ?? "");
	return match?.[1] ?? null;
}

/** Compares every Kubernetes identity field so a replacement Pod cannot use a former lease. */
function _MatchesLeaseRuntimePod(identity: ConversationComputerRuntimeIdentity, runtimePod: { readonly namespace: string; readonly serviceAccountName: string; readonly podUid: string } | null): boolean
{
	return runtimePod !== null && identity.namespace === runtimePod.namespace && identity.serviceAccountName === runtimePod.serviceAccountName && identity.podUid === runtimePod.podUid;
}
