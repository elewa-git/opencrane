import type { Prisma, PrismaClient } from "@prisma/client";
import { expect } from "vitest";

import { MCP_EXECUTOR_PROFILE_NAME, MCP_EXECUTOR_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";
import { PrismaToolInvocationLifecycleEventUnitOfWork, PrismaToolInvocationRunRecoveryAuthority, PrismaToolRecoveryEventReporter } from "@opencrane/backend/agents/execution/runs";
import { PrismaConversationToolDispatchAuthority } from "@opencrane/backend/server/conversations";
import { PrismaMcpRuntimeUnitOfWork, _CreateMcpToolInvocationAdmission, type McpInvocationResultParticipantFactory } from "@opencrane/backend/server/gateways/mcp";
import { __CreatePrismaMcpToolInvocationParticipantFactory } from "@opencrane/backend/server/iam/authorization";
import type { JsonValue } from "@opencrane/util";

import type { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

/** Reject generated resources from SQL cases whose result owner is deliberately scalar-only. */
function _IsEmbeddedResource(value: JsonValue): boolean
{
	return typeof value === "object" && value !== null && !Array.isArray(value) && "type" in value && value.type === "resource";
}

/** Build the explicit ordinary-result participant used outside generated-file composition proofs. */
function _ScalarInvocationResults(): McpInvocationResultParticipantFactory
{
	return { __ForTransaction: function _ForTransaction()
	{
		return { async prepare(command)
		{
			if (command.result.content.some(_IsEmbeddedResource))
				throw new Error("Scalar MCP result fixture rejects embedded resources");
			return command.result;
		} };
	} };
}

/** Wire the actual transaction owners without constructing a Kubernetes client or a provider. */
export function _ToolHandoffSqlRuntime(client: PrismaClient, fixture: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>, companionLeaseMs = 300_000, invocationResults: McpInvocationResultParticipantFactory = _ScalarInvocationResults())
{
	const observed = { notAfter: null as number | null };
	const participants = __CreatePrismaMcpToolInvocationParticipantFactory(new PrismaToolInvocationLifecycleEventUnitOfWork(client), new PrismaToolRecoveryEventReporter(), new PrismaToolInvocationRunRecoveryAuthority(), {
		async admitUntilInTransaction(transaction, invocation, now, workload)
		{
			observed.notAfter = await new PrismaConversationToolDispatchAuthority(transaction as Prisma.TransactionClient, fixture.dependencies).admitUntil(invocation, now, workload);
			return observed.notAfter;
		},
	});
	const options = { siloId: fixture.siloId, executorNamespace: "mcp-executors", executorServiceAccountName: MCP_EXECUTOR_SERVICE_ACCOUNT_NAME, profileName: MCP_EXECUTOR_PROFILE_NAME, controllerClaimLeaseMilliseconds: 30_000, companionClaimLeaseMilliseconds: companionLeaseMs, log: { info: function _QuietFixture() {} } as never };
	const authority = new PrismaMcpRuntimeUnitOfWork(client, { toolInvocations: participants, invocationResults, options });
	const admission = _CreateMcpToolInvocationAdmission(participants, options);
	let claim: Awaited<ReturnType<typeof authority.claimNextController>> = null;
	let release: Awaited<ReturnType<typeof authority.claimNextRelease>> = null;

	/** Finish only this fixture's controller steps; cleanup never claims a provider command. */
	async function _Register()
	{
		let execution = await client.mcpRuntimeExecution.findFirst({ where: { siloId: fixture.siloId } });
		if (execution === null)
			return null;
		const workloadUid = `${execution.id}-job`;
		const podUid = `${execution.id}-pod`;
		if (execution.workloadState === "Pending")
		{
			claim ??= await authority.claimNextController();
			expect(claim?.claim.claimId).toBe(execution.id);
			expect(await authority.commitAssignment({ claimId: execution.id, claimedAt: claim!.claim.claimedAt, deliveryCount: claim!.claim.deliveryCount, profileName: claim!.claim.profileName, workloadUid })).toBe("assigned");
			execution = await client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: execution.id } });
		}
		if (execution.workloadState === "Assigned" || execution.workloadState === "Released")
		{
			release ??= await authority.claimNextRelease();
			expect(release?.claim.claimId).toBe(execution.id);
			const command = { releaseClaimedAt: release!.releaseClaimedAt, releaseDeliveryCount: release!.releaseDeliveryCount, workloadUid };
			if (execution.workloadState === "Assigned")
				expect(await authority.commitRelease(execution.id, command)).toBe("released");
			expect(await authority.registerFirstPod(execution.id, { ...command, podUid })).toBe("registered");
		}
		return { executionId: execution.id, executionReference: execution.executionReference, identity: { subject: `system:serviceaccount:${options.executorNamespace}:${options.executorServiceAccountName}`, namespace: options.executorNamespace, serviceAccountName: options.executorServiceAccountName, podUid }, workloadUid };
	}
	return { admission, authority, observed, participants, register: _Register };
}

/** Wait against the real database clock with a fixed ceiling; never change immutable run evidence. */
export async function _WaitPastSqlDeadline(client: PrismaClient, deadline: number): Promise<void>
{
	const stop = Date.now() + 6_000;
	while (Date.now() < stop)
	{
		const clock = await client.mcpRuntimeClock.findUniqueOrThrow({ where: { singleton: 1 } });
		if (clock.now.getTime() > deadline)
			return;
		await new Promise(resolve => setTimeout(resolve, Math.min(25, Math.max(1, deadline - clock.now.getTime()))));
	}
	throw new Error("SQL deadline proof exceeded its bounded wait");
}
