import { createHash } from "node:crypto";

import Ajv from "ajv";
import { ExternalActionRecoveryMode, McpApprovalStatus, McpExecutorCommandState, McpExecutorWorkloadState, McpServerRevisionState, McpServerStatus, McpTaskState, Prisma, ToolInvocationState } from "@prisma/client";

import { PrismaManagedAuthorizationGrantRepository, type AuthorizationAuthority, type ManagedAuthorizationGrantRepository, type ManagedAuthorizationGrantSpec } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { MCP_ERA_PROTOCOL_VERSION } from "../era-probe/mcp-era-probe.types";
import { _McpTerminalWorkloadState } from "../runtime/mcp-runtime-terminal-workload-state";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _McpTaskCancellationConflictError, type McpTaskCreateResult, type McpTaskRepository, type McpTaskSubmissionRecord, type McpTaskWorkflowBinding } from "./mcp-task-repository.types";
import { McpTaskStates, type McpTaskInputRequest, type McpTaskInputResponse, type McpTaskRecord } from "./mcp-task.types";

/** Isolates grants that follow the durable creator relation of one public MCP task. */
const _MCP_TASK_CREATOR_GRANT_MANAGER_ID = "mcp-task-creator-access";

/** Fields returned by every task repository operation. */
const _TASK_SELECT = {
	id: true,
	siloId: true,
	principalId: true,
	requestKeyDigest: true,
	callDigest: true,
	serverRevisionId: true,
	toolRevisionId: true,
	protocolVersion: true,
	arguments: true,
	taskId: true,
	taskName: true,
	taskKey: true,
	state: true,
	inputRequest: true,
	inputResponse: true,
	result: true,
	failureCode: true,
	toolRevision: { select: { name: true, inputSchema: true } },
	toolInvocation: { select: { id: true, state: true, mcpRuntimeExecution: { select: { id: true, commandState: true, workloadState: true, workloadUid: true, deliveryCount: true, claimedAt: true, claimExpiresAt: true } } } },
} as const satisfies Prisma.McpTaskSelect;

/** Prisma projection mapped into the package contract. */
type _TaskProjection = Prisma.McpTaskGetPayload<{ select: typeof _TASK_SELECT }>;

/** Serialize one request key without retaining the caller's raw key. */
function _ClaimDigest(requestKeyDigest: string): string
{
	return `sha256:${createHash("sha256").update(`mcp-task:${requestKeyDigest}`).digest("hex")}`;
}

/** Parse a stored input request or fail closed when its shape drifted. */
function _InputRequest(value: Prisma.JsonValue | null): McpTaskInputRequest | null
{
	if (value === null)
		return null;
	if (typeof value !== "object" || Array.isArray(value))
		throw new Error("MCP task input request is invalid");
	if (typeof value.requestId !== "string" || typeof value.message !== "string" || typeof value.argumentName !== "string")
		throw new Error("MCP task input request is invalid");
	return { requestId: value.requestId, message: value.message, argumentName: value.argumentName };
}

/** Parse a stored input response or fail closed when its shape drifted. */
function _InputResponse(value: Prisma.JsonValue | null): McpTaskInputResponse | null
{
	if (value === null)
		return null;
	if (typeof value !== "object" || Array.isArray(value) || typeof value.requestId !== "string" || !("value" in value))
		throw new Error("MCP task input response is invalid");
	return { requestId: value.requestId, value: value.value as JsonValue };
}

/** Translate Prisma's database vocabulary into the public wire vocabulary. */
function _State(value: McpTaskState): McpTaskStates
{
	const states: Readonly<Record<McpTaskState, McpTaskStates>> = {
		[McpTaskState.Working]: McpTaskStates.Working,
		[McpTaskState.InputRequired]: McpTaskStates.InputRequired,
		[McpTaskState.Queued]: McpTaskStates.Queued,
		[McpTaskState.Running]: McpTaskStates.Running,
		[McpTaskState.Completed]: McpTaskStates.Completed,
		[McpTaskState.Cancelled]: McpTaskStates.Cancelled,
		[McpTaskState.Failed]: McpTaskStates.Failed,
		[McpTaskState.RecoveryRequired]: McpTaskStates.RecoveryRequired,
	};
	return states[value];
}

/** Map one selected row without exposing arguments or ownership through the public route. */
function _Record(value: _TaskProjection): McpTaskRecord
{
	let workflowTask = null;
	if (value.taskId !== null || value.taskName !== null || value.taskKey !== null)
	{
		if (value.taskId === null || value.taskName === null || value.taskKey === null)
			throw new Error("MCP task workflow binding is incomplete");
		workflowTask = { taskId: value.taskId, taskName: value.taskName, idempotencyKey: value.taskKey };
	}
	return {
		id: value.id,
		siloId: value.siloId,
		principalId: value.principalId,
		callDigest: value.callDigest,
		serverRevisionId: value.serverRevisionId,
		toolRevisionId: value.toolRevisionId,
		toolName: value.toolRevision.name,
		protocolVersion: value.protocolVersion,
		state: _State(value.state),
		inputRequest: _InputRequest(value.inputRequest),
		inputResponse: _InputResponse(value.inputResponse),
		result: value.result as JsonValue | null,
		failureCode: value.failureCode,
		toolInvocationRowId: value.toolInvocation?.id ?? null,
		workflowTask,
	};
}

/** Return true when arguments satisfy the exact discovered JSON Schema. */
function _ArgumentsAreValid(schema: Prisma.JsonValue, value: JsonValue): boolean
{
	try
	{
		const ajv = new Ajv({ allErrors: false, strict: true });
		const validator = ajv.compile(schema as object);
		return validator(value);
	}
	catch
	{
		return false;
	}
}

/** Apply the one saved top-level response without mutating the stored submission arguments. */
function _EffectiveArguments(task: _TaskProjection): JsonValue | null
{
	const request = _InputRequest(task.inputRequest);
	const response = _InputResponse(task.inputResponse);
	if (request === null)
		return task.arguments as JsonValue;
	if (response === null || typeof task.arguments !== "object" || task.arguments === null || Array.isArray(task.arguments))
		return null;
	return { ...(task.arguments as Record<string, JsonValue>), [request.argumentName]: response.value };
}

/** Transaction-scoped persistence for caller-owned public MCP tasks. */
export class PrismaMcpTaskRepository implements McpTaskRepository
{
	/** Prisma transaction shared with workflow admission. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Central product authority sharing this repository's transaction. */
	private readonly _authorization: AuthorizationAuthority;
	/** Shared grant writer that projects the creator relation inside this transaction. */
	private readonly _managedGrants: ManagedAuthorizationGrantRepository;

	/** Bind task and product authorization operations to one caller-owned database transaction. */
	constructor(transaction: Prisma.TransactionClient, authorization: AuthorizationAuthority, managedGrants: ManagedAuthorizationGrantRepository | null = null)
	{
		this._transaction = transaction;
		this._authorization = authorization;
		this._managedGrants = managedGrants ?? new PrismaManagedAuthorizationGrantRepository(transaction);
	}

	/** Create or replay one exact installed Ready MCP tool task. */
	async createOrFind(submission: McpTaskSubmissionRecord): Promise<McpTaskCreateResult | null>
	{
		await this._transaction.mcpTaskClaim.upsert({
			where: { siloId_identityDigest: { siloId: submission.siloId, identityDigest: _ClaimDigest(submission.requestKeyDigest) } },
			create: { siloId: submission.siloId, identityDigest: _ClaimDigest(submission.requestKeyDigest) },
			update: { touchedAt: new Date() },
			select: { identityDigest: true },
		});
		const existing = await this._transaction.mcpTask.findUnique({ where: { siloId_requestKeyDigest: { siloId: submission.siloId, requestKeyDigest: submission.requestKeyDigest } }, select: _TASK_SELECT });
		if (existing !== null)
		{
			if (existing.callDigest !== submission.callDigest || existing.principalId !== submission.principalId)
				return null;
			return await this._CanReadTask(submission.siloId, submission.principalId, existing.id) ? { created: false, task: _Record(existing) } : null;
		}
		const tool = await this._transaction.mcpToolRevision.findFirst({
			where: {
				id: submission.toolRevisionId,
				siloId: submission.siloId,
				serverRevisionId: submission.serverRevisionId,
				serverRevision: {
					is: {
						state: McpServerRevisionState.Ready,
						protocolVersion: MCP_ERA_PROTOCOL_VERSION,
						server: { is: { status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published, installs: { some: { principalId: submission.principalId } } } },
					},
				},
			},
			select: { inputSchema: true },
		});
		if (tool === null)
			return null;
		if (submission.inputRequest === null && !_ArgumentsAreValid(tool.inputSchema, submission.arguments))
			return null;
		if (submission.inputRequest !== null && (typeof submission.arguments !== "object" || submission.arguments === null || Array.isArray(submission.arguments)))
			return null;
		const created = await this._transaction.mcpTask.create({
			data: {
				siloId: submission.siloId,
				principalId: submission.principalId,
				requestKeyDigest: submission.requestKeyDigest,
				callDigest: submission.callDigest,
				serverRevisionId: submission.serverRevisionId,
				toolRevisionId: submission.toolRevisionId,
				protocolVersion: MCP_ERA_PROTOCOL_VERSION,
				arguments: submission.arguments as Prisma.InputJsonValue,
				inputRequest: submission.inputRequest === null ? Prisma.DbNull : submission.inputRequest as unknown as Prisma.InputJsonValue,
			},
			select: _TASK_SELECT,
		});
		await this._ReconcileCreatorGrants(submission.siloId, submission.principalId, created.id);
		return { created: true, task: _Record(created) };
	}

	/** Bind the exact Absurd receipt once. */
	async ensureWorkflow(siloId: string, taskId: string, binding: McpTaskWorkflowBinding): Promise<McpTaskRecord | null>
	{
		const current = await this._transaction.mcpTask.findFirst({ where: { id: taskId, siloId }, select: _TASK_SELECT });
		if (current === null)
			return null;
		if (current.taskId !== null || current.taskName !== null || current.taskKey !== null)
			return current.taskId === binding.taskId && current.taskName === binding.taskName && current.taskKey === binding.taskKey ? _Record(current) : null;
		const updated = await this._transaction.mcpTask.update({ where: { id: taskId }, data: binding, select: _TASK_SELECT });
		return _Record(updated);
	}

	/** Find one caller-owned task without disclosing other owners. */
	async find(siloId: string, principalId: string, taskId: string): Promise<McpTaskRecord | null>
	{
		const task = await this._transaction.mcpTask.findFirst({ where: { id: taskId, siloId, principalId }, select: _TASK_SELECT });
		if (task === null || !await this._CanReadTask(siloId, principalId, task.id))
			return null;
		return _Record(task);
	}

	/** Load the exact immutable call selected by Absurd input. */
	async load(siloId: string, taskId: string, callDigest: string): Promise<McpTaskRecord | null>
	{
		const task = await this._transaction.mcpTask.findFirst({ where: { id: taskId, siloId, callDigest }, select: _TASK_SELECT });
		return task === null ? null : _Record(task);
	}

	/** Persist the input-required transition idempotently. */
	async recordInputRequired(siloId: string, taskId: string, callDigest: string): Promise<McpTaskRecord | null>
	{
		await this._transaction.mcpTask.updateMany({ where: { id: taskId, siloId, callDigest, state: McpTaskState.Working, inputRequest: { not: Prisma.DbNull }, inputResponse: { equals: Prisma.DbNull } }, data: { state: McpTaskState.InputRequired } });
		return this.load(siloId, taskId, callDigest);
	}

	/** Save one matching input response without replacing an earlier value. */
	async recordInput(siloId: string, principalId: string, taskId: string, response: McpTaskInputResponse): Promise<McpTaskRecord | null>
	{
		const current = await this._transaction.mcpTask.findFirst({ where: { id: taskId, siloId, principalId }, select: _TASK_SELECT });
		if (current === null)
			return null;
		const request = _InputRequest(current.inputRequest);
		const stored = _InputResponse(current.inputResponse);
		if (request === null || request.requestId !== response.requestId)
			return null;
		if (stored !== null && ___DigestCanonicalJson(stored.value) !== ___DigestCanonicalJson(response.value))
			return null;
		if (stored === null && current.state !== McpTaskState.InputRequired)
			return null;
		const inputAdmission = await this._authorization.admitPrincipal({
			siloId,
			principalId,
			actorKind: "user",
			actorId: principalId,
			resource: { kind: ProductAuthorizationResourceKinds.McpTask, id: current.id },
			action: ProductAuthorizationActions.Edit,
			argumentsDigest: ___DigestCanonicalJson({ requestId: response.requestId, value: response.value }),
			nowEpochMs: Date.now(),
		});
		if (inputAdmission.outcome !== AuthorizationDecisionOutcomes.Allow)
			return null;
		if (stored !== null)
			return _Record(current);
		const updated = await this._transaction.mcpTask.updateMany({ where: { id: taskId, state: McpTaskState.InputRequired, inputResponse: { equals: Prisma.DbNull } }, data: { inputResponse: response as unknown as Prisma.InputJsonValue, state: McpTaskState.Working } });
		if (updated.count !== 1)
			return null;
		return this.load(siloId, taskId, current.callDigest);
	}

	/** Create a task-owned Ready ToolInvocation and queue it for the existing MCP runtime. */
	async admitAuthorizedToolInvocation(siloId: string, taskId: string, callDigest: string): Promise<McpTaskRecord | null>
	{
		const task = await this._transaction.mcpTask.findFirst({ where: { id: taskId, siloId, callDigest }, select: _TASK_SELECT });
		if (task === null)
			return null;
		if (task.toolInvocation !== null)
			return _Record(task);
		if (task.state === McpTaskState.Cancelled || task.state === McpTaskState.Failed || task.state === McpTaskState.RecoveryRequired || task.state === McpTaskState.Completed)
			return _Record(task);
		const effectiveArguments = _EffectiveArguments(task);
		if (effectiveArguments === null || !_ArgumentsAreValid(task.toolRevision.inputSchema, effectiveArguments))
		{
			const failed = await this._transaction.mcpTask.update({ where: { id: task.id }, data: { state: McpTaskState.Failed, failureCode: "invalid_tool_arguments", completedAt: new Date() }, select: _TASK_SELECT });
			return _Record(failed);
		}
		const now = new Date();
		const retryDeadlineAt = new Date(now.getTime() + 5 * 60_000);
		const argumentsDigest = ___DigestCanonicalJson(effectiveArguments);
		const invocationAdmission = await this._authorization.admitPrincipal({
			siloId: task.siloId,
			principalId: task.principalId,
			actorKind: "user",
			actorId: task.principalId,
			resource: { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: task.toolRevisionId },
			action: ProductAuthorizationActions.Invoke,
			argumentsDigest,
			nowEpochMs: now.getTime(),
		});
		if (invocationAdmission.outcome !== AuthorizationDecisionOutcomes.Allow)
		{
			const failed = await this._transaction.mcpTask.update({ where: { id: task.id }, data: { state: McpTaskState.Failed, failureCode: "mcp_tool_not_authorized", completedAt: now }, select: _TASK_SELECT });
			return _Record(failed);
		}
		const requestIdentity = { runtimeInstanceId: `mcp-task:${task.id}`, commandId: task.id, candidateId: task.id };
		const invocation = await this._transaction.toolInvocation.create({
			data: {
				siloId: task.siloId,
				mcpTaskId: task.id,
				subjectId: task.principalId,
				runtimeInstanceId: requestIdentity.runtimeInstanceId,
				commandId: requestIdentity.commandId,
				candidateId: requestIdentity.candidateId,
				toolRevisionId: task.toolRevisionId,
				toolInvocationId: `mcp-task-call:${task.id}`,
				arguments: effectiveArguments as Prisma.InputJsonValue,
				argumentsDigest,
				effectiveArguments: effectiveArguments as Prisma.InputJsonValue,
				effectiveArgumentsDigest: argumentsDigest,
				requestFingerprint: ___DigestCanonicalJson([task.id, task.callDigest, argumentsDigest]),
				requestIdentity,
				approvalRequired: false,
				recoveryMode: ExternalActionRecoveryMode.Manual,
				recoveryKey: null,
				state: ToolInvocationState.Ready,
				retryDeadlineAt,
				nextPreparationAttemptAt: now,
				createdAt: now,
			},
			select: { id: true },
		});
		const queued = await this._transaction.mcpTask.update({ where: { id: task.id }, data: { state: McpTaskState.Queued, failureCode: null }, select: _TASK_SELECT });
		if (queued.toolInvocation?.id !== invocation.id)
			throw new Error("MCP task lost its ToolInvocation ownership binding");
		return _Record(queued);
	}

	/** Save one bounded failure only while provider dispatch has not started. */
	async recordFailure(siloId: string, taskId: string, callDigest: string, failureCode: string): Promise<McpTaskRecord | null>
	{
		const safeCode = /^[a-z][a-z0-9_]{0,63}$/u.test(failureCode) ? failureCode : "mcp_task_failed";
		await this._transaction.mcpTask.updateMany({ where: { id: taskId, siloId, callDigest, state: { in: [McpTaskState.Working, McpTaskState.InputRequired, McpTaskState.Queued] } }, data: { state: McpTaskState.Failed, failureCode: safeCode, completedAt: new Date() } });
		return this.load(siloId, taskId, callDigest);
	}

	/** Cancel only before a provider-effect claim starts. */
	async cancel(siloId: string, principalId: string, taskId: string): Promise<"cancelled" | "not_available" | "too_late">
	{
		const task = await this._transaction.mcpTask.findFirst({ where: { id: taskId, siloId, principalId }, select: _TASK_SELECT });
		if (task === null || task.state === McpTaskState.Completed || task.state === McpTaskState.Cancelled || task.state === McpTaskState.Failed || task.state === McpTaskState.RecoveryRequired)
			return "not_available";
		if (task.state === McpTaskState.Running || task.toolInvocation?.state === ToolInvocationState.Claimed || task.toolInvocation?.state === ToolInvocationState.Reconciling)
			return "too_late";
		const cancellationAdmission = await this._authorization.admitPrincipal({
			siloId,
			principalId,
			actorKind: "user",
			actorId: principalId,
			resource: { kind: ProductAuthorizationResourceKinds.McpTask, id: task.id },
			action: ProductAuthorizationActions.Cancel,
			argumentsDigest: ___DigestCanonicalJson({ taskId: task.id }),
			nowEpochMs: Date.now(),
		});
		if (cancellationAdmission.outcome !== AuthorizationDecisionOutcomes.Allow)
			return "not_available";
		if (task.toolInvocation !== null)
		{
			const execution = task.toolInvocation.mcpRuntimeExecution;
			const terminalAt = new Date();
			if (execution !== null)
			{
				const workloadState = _McpTerminalWorkloadState(execution, McpExecutorWorkloadState);
				if (workloadState === null)
					return "too_late";
				const updated = await this._transaction.mcpRuntimeExecution.updateMany({ where: { id: execution.id, toolInvocationId: task.toolInvocation.id, commandState: McpExecutorCommandState.Pending, workloadState: execution.workloadState, workloadUid: execution.workloadUid, deliveryCount: execution.deliveryCount, claimedAt: execution.claimedAt, claimExpiresAt: execution.claimExpiresAt }, data: { commandState: McpExecutorCommandState.Failed, workloadState, terminalOutcome: "mcp_task_cancelled", completedAt: terminalAt } });
				if (updated.count !== 1)
					throw new _McpTaskCancellationConflictError();
			}
			const invocation = await this._transaction.toolInvocation.updateMany({ where: { id: task.toolInvocation.id, state: ToolInvocationState.Ready }, data: { state: ToolInvocationState.Failed, failureCode: "mcp_task_cancelled", completedAt: terminalAt, revision: { increment: 1 } } });
			if (invocation.count !== 1)
				throw new _McpTaskCancellationConflictError();
		}
		const updated = await this._transaction.mcpTask.updateMany({ where: { id: task.id, state: { in: [McpTaskState.Working, McpTaskState.InputRequired, McpTaskState.Queued] } }, data: { state: McpTaskState.Cancelled, cancelRequestedAt: new Date(), completedAt: new Date(), failureCode: null } });
		if (updated.count !== 1)
			throw new _McpTaskCancellationConflictError();
		return "cancelled";
	}

	/** Return whether the Principal still holds the exact task read grant through any current subject. */
	private async _CanReadTask(siloId: string, principalId: string, taskId: string): Promise<boolean>
	{
		const entitled = await this._authorization.listPrincipalEntitled({ siloId, principalId, action: ProductAuthorizationActions.Read, resources: [{ kind: ProductAuthorizationResourceKinds.McpTask, id: taskId }], nowEpochMs: Date.now() });
		return entitled.length === 1;
	}

	/** Project the exact creator read, input-response and cancellation grants beside a new task. */
	private async _ReconcileCreatorGrants(siloId: string, principalId: string, taskId: string): Promise<void>
	{
		const resource = { kind: ProductAuthorizationResourceKinds.McpTask, id: taskId } as const;
		const actions = [ProductAuthorizationActions.Read, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Cancel] as const;
		const grants = actions.map(function _Grant(action): ManagedAuthorizationGrantSpec
		{
			const capability = __ProductAuthorizationCapability(resource.kind, action);
			if (capability === null)
				throw new Error(`MCP task capability ${action} is unavailable`);
			return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: principalId };
		});
		await this._managedGrants.reconcileManagedResourceGrants({ siloId, managerId: _MCP_TASK_CREATOR_GRANT_MANAGER_ID, resource, grants, now: new Date() });
	}
}
