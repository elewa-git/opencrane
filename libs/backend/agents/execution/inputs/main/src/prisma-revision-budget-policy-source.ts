import { AgentRevisionState, Prisma } from "@prisma/client";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { BudgetPolicyInput, BudgetPolicySource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/** Reads and freezes the exact published revision's immutable run ceilings at admission. */
export class PrismaRevisionBudgetPolicySource implements BudgetPolicySource
{
	/** Refuses an absent, foreign, non-published, malformed, or unrepresentable revision budget. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<BudgetPolicyInput>>
	{
		// 1. Lock the exact revision before rereading it, so publication/revocation cannot race snapshot admission.
		await transaction.prisma.$queryRaw(Prisma.sql`SELECT revision."id" FROM "agent_revisions" revision JOIN "agent_services" service ON service."id" = revision."agent_service_id" WHERE revision."id" = ${run.agentRevisionId} AND revision."agent_service_id" = ${run.agentServiceId} AND service."silo_id" = ${command.siloId} FOR UPDATE OF revision`);

		// 2. Revalidate the active, published revision beneath the same transaction fence.
		const revision = await transaction.prisma.agentRevision.findFirst({ where: { id: run.agentRevisionId, agentServiceId: run.agentServiceId, state: AgentRevisionState.Published, agentService: { is: { siloId: command.siloId } } }, select: { budget: true } });
		if (revision === null) return { outcome: "denied", reason: "budget_unavailable" };

		// 3. Project only the canonical revision ceilings into the runtime's frozen policy.
		const budget = _parseBudget(revision.budget, transaction.admittedAtEpochMs);
		return budget === null ? { outcome: "denied", reason: "budget_unavailable" } : { outcome: "loaded", value: { budgetPolicy: budget } };
	}
}

/** Parses complete immutable revision JSON into the runtime policy vocabulary without defaults. */
function _parseBudget(value: Prisma.JsonValue, admittedAtEpochMs: number): BudgetPolicyInput["budgetPolicy"] | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value) || !Number.isSafeInteger(admittedAtEpochMs)) return null;
	const budget = value as Record<string, unknown>;
	if (!_isPositiveSafeInteger(budget.maxTurns) || !_isPositiveSafeInteger(budget.maxTokens) || !_isPositiveSafeInteger(budget.maxCostUsdMicros) || !_isPositiveSafeInteger(budget.maxDurationMs)) return null;
	const deadline = admittedAtEpochMs + budget.maxDurationMs;
	if (!Number.isSafeInteger(deadline)) return null;
	return { maxTurns: budget.maxTurns, maxTotalTokens: budget.maxTokens, maxCostUsdMicros: budget.maxCostUsdMicros, maxToolInvocations: null, wallClockDeadlineEpochMs: deadline };
}

/** Returns whether one persisted ceiling is a positive safe integer. */
function _isPositiveSafeInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
