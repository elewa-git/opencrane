import type { Prisma, PrismaClient } from "@prisma/client";
import { expect } from "vitest";

import { MCP_EXECUTOR_PROFILE_NAME, MCP_EXECUTOR_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";
import { PrismaToolInvocationLifecycleEventUnitOfWork, PrismaToolInvocationRunRecoveryAuthority, PrismaToolRecoveryEventReporter } from "@opencrane/backend/agents/execution/runs";
import { PrismaConversationToolDispatchAuthority, type ConversationToolProposalRuntimeAdmission } from "@opencrane/backend/server/conversations";
import { PrismaMcpRuntimeUnitOfWork, PrismaMcpToolInvocationAdmissionRepository } from "@opencrane/backend/server/gateways/mcp";
import { __CreatePrismaMcpToolInvocationParticipantFactory } from "@opencrane/backend/server/iam/authorization";

import type { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

/** Wire the actual transaction owners without constructing a Kubernetes client or a provider. */
export function _ToolHandoffSqlRuntime(client: PrismaClient, fixture: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>, companionLeaseMs = 300_000)
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
	const authority = new PrismaMcpRuntimeUnitOfWork(client, { toolInvocations: participants, options });
	const admission: ConversationToolProposalRuntimeAdmission = async function _AdmitInSameTransaction(transaction, invocationRowId)
	{
		const repository = new PrismaMcpToolInvocationAdmissionRepository(transaction as Prisma.TransactionClient, participants.__ForTransaction(transaction), options);
		const result = await repository.admitInvocation(invocationRowId);
		return result === "admitted" || result === "idempotent";
	};
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
	return { admission, authority, observed, register: _Register };
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
