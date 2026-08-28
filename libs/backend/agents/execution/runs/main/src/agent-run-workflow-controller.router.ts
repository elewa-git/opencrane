import { Router, type Request, type Response } from "express";

import { __ParseAgentRunWorkflowTaskRequest, type AgentRunTaskInput, type AgentRunWarmRuntimeActivationCommand, type AgentRunWarmRuntimeDeletionCommand, type AgentRunWarmRuntimeDeletionOutcome, type AgentRunWarmRuntimeReadinessCommand, type AgentRunWarmRuntimeReplacementOutcome, type AgentRunWarmRuntimeReservationCommand, type AgentRunWarmRuntimeUnreservedCancellationOutcome } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";

import type { AgentRunWorkflowControllerIdentity, AgentRunWorkflowControllerRouterDependencies } from "./agent-run-workflow-controller.router.types";

/**
 * Creates the controller-only API for the durable AgentRun workflow handler.
 *
 * Every operation checks the caller's projected controller identity before parsing a workflow task
 * receipt. The server then keeps lifecycle, database fencing, raw-key revocation, and terminal
 * state in one task-bound authority; HTTP only transports the controller's observed Kubernetes IDs.
 *
 * Called by: `_CreateControllerRuntimeComposition` in the OpenCrane app.
 * @param dependencies - Supplies the reviewed controller identity, server authority, and logger.
 * @returns A router mounted below `/api/internal/agent-controller`.
 */
export function __CreateAgentRunWorkflowControllerRouter(dependencies: AgentRunWorkflowControllerRouterDependencies): Router
{
	const router = Router();

	router.post("/agent-run-workflows/load", async function _Load(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const command = __ParseAgentRunWorkflowTaskRequest(request.body);
			if (command === null)
			{
				_RespondProblem(response, 400, "invalid_agent_run_task");
				return;
			}
			const record = await dependencies.warmAuthority.loadForTask(command.input, command.task);
			if (record === null)
			{
				_RespondProblem(response, 409, "stale_or_unavailable_agent_run");
				return;
			}
			response.status(200).json(record);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.agent_run_workflow.load");
			_RespondProblem(response, 503, "agent_run_workflow_unavailable");
		}
	});

	_RegisterWarmBinding(router, "/agent-run-workflows/warm-reservation", dependencies, _WarmReservation, "agent_controller.agent_run_workflow.warm_reservation", async function _Reserve(input, task, command) { return await dependencies.warmAuthority.reserveWarmPod(input, task, command); });
	_RegisterWarmBinding(router, "/agent-run-workflows/warm-activation", dependencies, _WarmActivation, "agent_controller.agent_run_workflow.warm_activation", async function _Activation(input, task, command) { return await dependencies.warmAuthority.recordWarmProfileActivation(input, task, command); });
	_RegisterWarmBinding(router, "/agent-run-workflows/warm-readiness", dependencies, _WarmReadiness, "agent_controller.agent_run_workflow.warm_readiness", async function _Readiness(input, task, command) { return await dependencies.warmAuthority.recordWarmReadiness(input, task, command); });
	_RegisterWarmBinding(router, "/agent-run-workflows/warm-delete-request", dependencies, _WarmDeletion, "agent_controller.agent_run_workflow.warm_delete_request", async function _DeleteRequest(input, task, command) { return await dependencies.warmAuthority.requestWarmPodDeletion(input, task, command); });
	_RegisterWarmBinding(router, "/agent-run-workflows/warm-deleted", dependencies, _WarmDeletion, "agent_controller.agent_run_workflow.warm_deleted", async function _Deleted(input, task, command) { return await dependencies.warmAuthority.recordWarmPodDeleted(input, task, command); });
	_RegisterWarmBinding(router, "/agent-run-workflows/warm-replacement", dependencies, _WarmDeletion, "agent_controller.agent_run_workflow.warm_replacement", async function _Replacement(input, task, command) { return await dependencies.warmAuthority.prepareWarmRuntimeReplacement(input, task, command); });

	router.post("/agent-run-workflows/warm-unreserved-cancellation", async function _UnreservedCancellation(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const command = __ParseAgentRunWorkflowTaskRequest(request.body);
			if (command === null)
			{
				_RespondProblem(response, 400, "invalid_agent_run_task");
				return;
			}
			_RespondCancellation(response, await dependencies.warmAuthority.finalizeCancellationWithoutWarmReservation(command.input, command.task));
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.agent_run_workflow.warm_unreserved_cancellation");
			_RespondProblem(response, 503, "warm_runtime_workflow_unavailable");
		}
	});

	router.post("/agent-run-workflows/terminal-failure", async function _TerminalFailure(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const command = __ParseAgentRunWorkflowTaskRequest(request.body);
			if (command === null)
			{
				_RespondProblem(response, 400, "invalid_agent_run_task");
				return;
			}
			await dependencies.warmAuthority.terminalizeFailedTask(command.input, command.task);
			response.status(204).end();
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.agent_run_workflow.terminal_failure");
			_RespondProblem(response, 503, "agent_run_workflow_unavailable");
		}
	});

	router.post("/agent-run-workflows/observe", async function _Observe(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const command = __ParseAgentRunWorkflowTaskRequest(request.body);
			if (command === null)
			{
				_RespondProblem(response, 400, "invalid_agent_run_task");
				return;
			}
			response.status(200).json(await dependencies.warmAuthority.observe(command.input, command.task));
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.agent_run_workflow.observe");
			_RespondProblem(response, 503, "agent_run_workflow_unavailable");
		}
	});

	return router;
}

/** Names the common envelope returned after a warm command passes structural checks. */
type WarmCommand<TCommand> = { readonly input: AgentRunTaskInput; readonly task: IWorkflowTaskReceipt; readonly command: TCommand };

/** Parses the shared receipt and returns its untrusted command object. */
function _WarmEnvelope(value: unknown): { readonly input: AgentRunTaskInput; readonly task: IWorkflowTaskReceipt; readonly command: Record<string, unknown> } | null
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
	{
		return null;
	}
	const record = value as Record<string, unknown>;
	const base = __ParseAgentRunWorkflowTaskRequest({ input: record["input"], task: record["task"] });
	const command = record["command"];
	if (base === null || typeof command !== "object" || command === null || Array.isArray(command))
	{
		return null;
	}
	return { ...base, command: command as Record<string, unknown> };
}

/** Returns a bounded non-empty string field. */
function _WarmString(command: Record<string, unknown>, name: string): string | null
{
	const value = command[name];
	return typeof value === "string" && value.trim().length > 0 && value.length <= 256 ? value : null;
}

/** Parses the candidate Pod and pool identity offered for reservation. */
function _WarmReservation(value: unknown): WarmCommand<AgentRunWarmRuntimeReservationCommand> | null
{
	const envelope = _WarmEnvelope(value);
	if (envelope === null)
	{
		return null;
	}
	const names = ["workloadProfile", "deploymentName", "deploymentUid", "podName", "podUid", "podResourceVersion", "genericProfile", "claimedProfile", "serviceAccountName"] as const;
	const fields = Object.fromEntries(names.map(function _Field(name) { return [name, _WarmString(envelope.command, name)]; }));
	if (Object.values(fields).some(function _Missing(field) { return field === null; }))
	{
		return null;
	}
	const generation = envelope.command["generation"];
	return !Number.isSafeInteger(generation) || (generation as number) < 1 ? null : { input: envelope.input, task: envelope.task, command: { ...fields, generation } as unknown as AgentRunWarmRuntimeReservationCommand };
}

/** Parses the result of one conditional profile patch. */
function _WarmActivation(value: unknown): WarmCommand<AgentRunWarmRuntimeActivationCommand> | null
{
	const envelope = _WarmEnvelope(value);
	const podUid = envelope === null ? null : _WarmString(envelope.command, "podUid");
	const resourceVersion = envelope === null ? null : _WarmString(envelope.command, "resourceVersion");
	const profile = envelope === null ? null : _WarmString(envelope.command, "profile");
	return envelope === null || podUid === null || resourceVersion === null || profile === null ? null : { input: envelope.input, task: envelope.task, command: { podUid, resourceVersion, profile } };
}

/** Parses readiness evidence for the activated Pod. */
function _WarmReadiness(value: unknown): WarmCommand<AgentRunWarmRuntimeReadinessCommand> | null
{
	const activation = _WarmActivation(value);
	const envelope = _WarmEnvelope(value);
	const observedAt = envelope === null ? null : _WarmString(envelope.command, "observedAt");
	if (activation === null || observedAt === null || Number.isNaN(new Date(observedAt).getTime()))
	{
		return null;
	}
	return { ...activation, command: { ...activation.command, observedAt } };
}

/** Parses the identity required for one-way exact Pod deletion. */
function _WarmDeletion(value: unknown): WarmCommand<AgentRunWarmRuntimeDeletionCommand> | null
{
	const envelope = _WarmEnvelope(value);
	const podName = envelope === null ? null : _WarmString(envelope.command, "podName");
	const podUid = envelope === null ? null : _WarmString(envelope.command, "podUid");
	const deploymentUid = envelope === null ? null : _WarmString(envelope.command, "deploymentUid");
	const profile = envelope === null ? null : _WarmString(envelope.command, "profile");
	const generation = envelope?.command["generation"];
	return envelope === null || podName === null || podUid === null || deploymentUid === null || profile === null || !Number.isSafeInteger(generation) || (generation as number) < 1 ? null : { input: envelope.input, task: envelope.task, command: { generation: generation as number, podName, podUid, deploymentUid, profile } };
}

/** Registers one authenticated warm command route with the common conflict response. */
function _RegisterWarmBinding<TCommand>(router: Router, path: string, dependencies: AgentRunWorkflowControllerRouterDependencies, parse: (value: unknown) => WarmCommand<TCommand> | null, operation: string, execute: (input: WarmCommand<TCommand>["input"], task: WarmCommand<TCommand>["task"], command: TCommand) => Promise<AgentRunWarmRuntimeDeletionOutcome | AgentRunWarmRuntimeReplacementOutcome>): void
{
	router.post(path, async function _WarmBinding(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const parsed = parse(request.body);
			if (parsed === null)
			{
				_RespondProblem(response, 400, "invalid_warm_runtime_command");
				return;
			}
			_RespondBinding(response, await execute(parsed.input, parsed.task, parsed.command));
		}
		catch (err)
		{
			_LogFailure(dependencies, err, operation);
			_RespondProblem(response, 503, "warm_runtime_workflow_unavailable");
		}
	});
}

/** Checks the one controller ServiceAccount identity allowed to act for AgentRun tasks. */
async function _IsController(request: Request, dependencies: AgentRunWorkflowControllerRouterDependencies): Promise<boolean>
{
	const token = _BearerValue(request.header("authorization"));
	if (token === null)
	{
		return false;
	}
	const identity = await dependencies.tokenReviewer.__Review(token);
	return identity !== null && _IdentityMatches(identity, dependencies.namespace);
}

/** Compares each reviewed identity fact with the dedicated controller deployment identity. */
function _IdentityMatches(identity: AgentRunWorkflowControllerIdentity, namespace: string): boolean
{
	return identity.username === `system:serviceaccount:${namespace}:${AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME}`
		&& identity.namespace === namespace
		&& identity.serviceAccountName === AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME
		&& identity.audiences.includes(AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE);
}

/** Reads exactly one bearer value and rejects ambiguous authorization headers. */
function _BearerValue(value: string | undefined): string | null
{
	if (value === undefined)
	{
		return null;
	}
	return /^Bearer ([^\s,]+)$/u.exec(value)?.[1] ?? null;
}

/** Returns a binding result, or a conflict that stops a stale controller task. */
function _RespondBinding(response: Response, outcome: AgentRunWarmRuntimeDeletionOutcome | AgentRunWarmRuntimeReplacementOutcome): void
{
	if (outcome === "conflict")
	{
		_RespondProblem(response, 409, "stale_or_conflicting_agent_run");
		return;
	}
	response.status(200).json({ outcome });
}

/** Returns an unreserved-cancellation result without exposing persistence details. */
function _RespondCancellation(response: Response, outcome: AgentRunWarmRuntimeUnreservedCancellationOutcome): void
{
	if (outcome === "conflict")
	{
		_RespondProblem(response, 409, "stale_or_conflicting_agent_run");
		return;
	}
	response.status(200).json({ outcome });
}

/** Logs only a route name and error, leaving raw request values out of structured logs. */
function _LogFailure(dependencies: AgentRunWorkflowControllerRouterDependencies, err: unknown, operation: string): void
{
	dependencies.logger.error({ err, operation }, "AgentRun workflow controller request failed");
}

/** Returns one bounded internal problem response without durable state details. */
function _RespondProblem(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
