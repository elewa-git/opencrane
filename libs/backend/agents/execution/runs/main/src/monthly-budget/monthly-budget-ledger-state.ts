import { ___ConversationModelPreForwardReceiptSchema, ___ExecutionSubjectSchema, ExecutionSubjectMembershipKinds } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { _PriceEurMicros } from "./monthly-budget-math";
import type { ManagedMonthlyBudgetAccountRecord, ManagedMonthlyBudgetEffectRecord, ManagedMonthlyBudgetPolicyRecord, ManagedMonthlyBudgetRunRecord, ManagedMonthlyBudgetTariffWithModelRecord, PreparedManagedMonthlyBudgetReserve } from "./monthly-budget-persistence.types";
import { ManagedMonthlyBudgetReservationStates, type ManagedMonthlyBudgetAttemptCommand, type ManagedMonthlyBudgetPreForwardReleaseCommand, type ManagedMonthlyBudgetReservation, type ManagedMonthlyBudgetSettlementResult } from "./monthly-budget.types";

/** Parse frozen route fields used by ledger admission without filling missing defaults. */
export function _ModelRoute(value: unknown): { readonly alias: string; readonly maxOutputTokens: number | null }
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("Managed monthly budget found an invalid immutable model route");
	const route = value as Record<string, unknown>;
	const alias = route["alias"];
	const maxOutputTokens = route["maxOutputTokens"];
	if (typeof alias !== "string" || alias.length < 1 || maxOutputTokens !== null && (typeof maxOutputTokens !== "number" || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1))
		throw new Error("Managed monthly budget found an invalid immutable model route");
	return { alias, maxOutputTokens };
}

/** Prove personal work from both the stored service kind and saved execution subject. */
export function _IsProvenPersonalRun(run: ManagedMonthlyBudgetRunRecord): boolean
{
	const subject = ___ExecutionSubjectSchema.safeParse(run.executionSubject);
	if (!subject.success)
		throw new Error("Managed monthly budget found an invalid saved execution subject");
	if (run.service.kind === "Personal")
	{
		if (subject.data.membership.kind === ExecutionSubjectMembershipKinds.Managed || !_PayerFields(run).every(value => value === null))
			throw new Error("Managed monthly budget found mismatched personal ownership or payer evidence");
		return true;
	}
	if (run.service.kind !== "Managed" || subject.data.membership.kind !== ExecutionSubjectMembershipKinds.Managed)
		throw new Error("Managed monthly budget cannot prove the run ownership kind");
	return false;
}

/** Require the complete managed payer authorization evidence bundle. */
export function _RequireManagedPayer(run: ManagedMonthlyBudgetRunRecord): void
{
	if (!_PayerFields(run).every(value => typeof value === "string" && value.length > 0))
		throw new Error("Managed monthly budget requires complete paying-group authorization evidence");
}

/** Return the payer identifier and its three authorization digests. */
function _PayerFields(run: ManagedMonthlyBudgetRunRecord): readonly (string | null)[]
{
	return [run.payingGroupId, run.payingGroupAuthorizationDecisionDigest, run.payingGroupAuthorizationPolicyRevisionHash, run.payingGroupEffectiveAuthorizationDigest];
}

/** Require exactly one global and group policy, plus at most one optional assistant policy. */
export function _RequireApplicablePolicies(policies: readonly ManagedMonthlyBudgetPolicyRecord[], payingGroupId: string): void
{
	const global = policies.filter(policy => policy.scope === "Global" && policy.scopeKey === "global" && policy.groupId === null && policy.agentServiceId === null);
	const group = policies.filter(policy => policy.scope === "Group" && policy.scopeKey === payingGroupId && policy.groupId === payingGroupId && policy.agentServiceId === null);
	const agent = policies.filter(policy => policy.scope === "AgentService" && policy.groupId === null && policy.agentServiceId === policy.scopeKey);
	if (global.length !== 1 || group.length !== 1 || agent.length > 1 || policies.length !== 2 + agent.length)
		throw new Error("Managed monthly budget requires one global and paying-group policy with at most one assistant policy");
}

/** Verify the persisted tariff row equals the validated quote at database time. */
export function _TariffMatches(tariff: ManagedMonthlyBudgetTariffWithModelRecord, prepared: PreparedManagedMonthlyBudgetReserve, now: Date): boolean
{
	const quote = prepared.quote.tariff;
	const { digest, ...identity } = quote;
	return tariff.digest === digest && ___DigestCanonicalJson(identity) === digest && tariff.revision === quote.revision
		&& tariff.modelDefinition.publicModelName === quote.modelAlias && tariff.tokenUnit === BigInt(quote.tokenUnit) && tariff.maxInputTokens === quote.maxInputTokens
		&& tariff.inputEurMicrosPerUnit === BigInt(quote.inputEurMicrosPerUnit) && tariff.outputEurMicrosPerUnit === BigInt(quote.outputEurMicrosPerUnit)
		&& tariff.effectiveAt.getTime() === Date.parse(quote.effectiveAt) && tariff.validUntil.getTime() === Date.parse(quote.validUntil)
		&& now >= tariff.effectiveAt && now < tariff.validUntil;
}

/** Verify a logical replay is equivalent in every persisted monetary coordinate. */
export function _AssertEffectMatchesReserve(effect: ManagedMonthlyBudgetEffectRecord, prepared: PreparedManagedMonthlyBudgetReserve, run: ManagedMonthlyBudgetRunRecord): void
{
	if (effect.siloId !== prepared.command.siloId || effect.runId !== run.id || effect.runAttempt !== run.attempt || effect.payingGroupId !== run.payingGroupId || effect.agentServiceId !== run.agentServiceId
		|| effect.modelAlias !== prepared.command.modelAlias || effect.maxInputTokens !== prepared.quote.tariff.maxInputTokens || effect.maxCompletionTokens !== prepared.command.maxCompletionTokens
		|| effect.tariffRevision !== prepared.quote.tariff.revision || effect.tariffDigest !== prepared.quote.tariff.digest || effect.quoteDigest !== prepared.quoteDigest || effect.worstCaseEurMicros !== prepared.worstCaseEurMicros)
		throw new Error("Managed monthly budget logical fence was already used with different coordinates");
}

/** Project one durable effect as a receipt for later claim and settlement. */
export function _Reservation(effect: ManagedMonthlyBudgetEffectRecord): ManagedMonthlyBudgetReservation
{
	return { effectId: effect.id, siloId: effect.siloId, runId: effect.runId, runAttempt: effect.runAttempt, payingGroupId: effect.payingGroupId, agentServiceId: effect.agentServiceId, logicalFence: effect.logicalFence, modelAlias: effect.modelAlias, maxInputTokens: effect.maxInputTokens, maxCompletionTokens: effect.maxCompletionTokens, periodStart: effect.periodStart.toISOString(), worstCaseEurMicros: effect.worstCaseEurMicros.toString(), tariffRevisionId: effect.tariffRevisionId, tariffRevision: effect.tariffRevision, tariffDigest: effect.tariffDigest, quoteDigest: effect.quoteDigest, state: _State(effect.state) };
}

/** Verify every immutable receipt field before changing an effect. */
export function _ReceiptMatches(effect: ManagedMonthlyBudgetEffectRecord, receipt: ManagedMonthlyBudgetReservation): boolean
{
	return effect.id === receipt.effectId && effect.siloId === receipt.siloId && effect.runId === receipt.runId && effect.runAttempt === receipt.runAttempt && effect.payingGroupId === receipt.payingGroupId && effect.agentServiceId === receipt.agentServiceId && effect.logicalFence === receipt.logicalFence && effect.modelAlias === receipt.modelAlias && effect.maxInputTokens === receipt.maxInputTokens && effect.maxCompletionTokens === receipt.maxCompletionTokens && effect.periodStart.toISOString() === receipt.periodStart && effect.worstCaseEurMicros.toString() === receipt.worstCaseEurMicros && effect.tariffRevisionId === receipt.tariffRevisionId && effect.tariffRevision === receipt.tariffRevision && effect.tariffDigest === receipt.tariffDigest && effect.quoteDigest === receipt.quoteDigest;
}

/** Return the exact physical attempt and reject changed replay coordinates. */
export function _ExactAttempt(effect: ManagedMonthlyBudgetEffectRecord, command: ManagedMonthlyBudgetAttemptCommand): ManagedMonthlyBudgetEffectRecord["attempts"][number]
{
	const attempt = effect.attempts.find(value => value.physicalNonce === command.physicalNonce);
	if (attempt === undefined)
		throw new Error("Managed monthly budget physical claim does not exist");
	_AssertAttemptMatches(attempt, command);
	return attempt;
}

/** Bind a replay to the serialized request and original deadline. */
export function _AssertAttemptMatches(attempt: ManagedMonthlyBudgetEffectRecord["attempts"][number], command: ManagedMonthlyBudgetAttemptCommand): void
{
	if (attempt.requestBodySha256 !== command.requestBodySha256 || attempt.deadlineEpochMs !== BigInt(command.deadlineEpochMs))
		throw new Error("Managed monthly budget physical nonce was already used with different request evidence");
}

/** Verify every ledger-visible field from a transport-authenticated no-forward receipt. */
export function _AssertPreForwardReceipt(command: ManagedMonthlyBudgetPreForwardReleaseCommand): void
{
	const receipt = ___ConversationModelPreForwardReceiptSchema.parse(command.receipt);
	if (receipt.physicalNonce !== command.physicalNonce || receipt.logicalFence !== command.reservation.logicalFence || receipt.requestBodySha256 !== command.requestBodySha256 || receipt.deadlineEpochMs !== command.deadlineEpochMs)
		throw new Error("Managed monthly budget no-forward receipt does not match the physical claim");
}

/** Return whether a monthly account is durably closed. */
export function _IsClosed(account: ManagedMonthlyBudgetAccountRecord): boolean { return account.admissionClosedAt !== null; }

/** Return irrevocable known and unknown liability. */
export function _Incurred(account: ManagedMonthlyBudgetAccountRecord): bigint { return account.settledEurMicros + account.unknownEurMicros; }

/** Return irrevocable liability plus active physical claims. */
export function _IncurredAndClaimed(account: ManagedMonthlyBudgetAccountRecord): bigint { return _Incurred(account) + account.claimedEurMicros; }

/** Return every incurred or held amount used during reservation admission. */
export function _PossibleLiability(account: ManagedMonthlyBudgetAccountRecord): bigint { return _IncurredAndClaimed(account) + account.reservedEurMicros; }

/** Return whether any scope impacted by an effect is durably closed. */
export function _AdmissionClosed(effect: ManagedMonthlyBudgetEffectRecord): boolean { return effect.impacts.some(impact => _IsClosed(impact.account)); }

/** Return whether no later state transition is legal for this logical effect. */
export function _IsTerminal(state: string): boolean { return state === "Settled" || state === "Unknown" || state === "PriceIntegrityBreach" || state === "Cancelled"; }

/** Recover an idempotent terminal settlement result from retained evidence. */
export function _TerminalSettlement(effect: ManagedMonthlyBudgetEffectRecord): ManagedMonthlyBudgetSettlementResult
{
	let actualEurMicros: string | undefined;
	if (effect.actualInputTokens !== null && effect.actualOutputTokens !== null)
	{
		if (effect.actualInputTokens > BigInt(Number.MAX_SAFE_INTEGER) || effect.actualOutputTokens > BigInt(Number.MAX_SAFE_INTEGER))
			throw new Error("Managed monthly budget stored token evidence exceeds the normalized usage contract");
		actualEurMicros = _PriceEurMicros(Number(effect.actualInputTokens), Number(effect.actualOutputTokens), effect.tariff.inputEurMicrosPerUnit, effect.tariff.outputEurMicrosPerUnit, effect.tariff.tokenUnit).toString();
	}
	return { state: _State(effect.state), ...(actualEurMicros === undefined ? {} : { actualEurMicros }), admissionClosed: _AdmissionClosed(effect) };
}

/** Map the database lifecycle to the public closed vocabulary. */
export function _State(state: string): ManagedMonthlyBudgetReservationStates
{
	switch (state)
	{
		case "Reserved": return ManagedMonthlyBudgetReservationStates.Reserved;
		case "Claimed": return ManagedMonthlyBudgetReservationStates.Claimed;
		case "Settled": return ManagedMonthlyBudgetReservationStates.Settled;
		case "Unknown": return ManagedMonthlyBudgetReservationStates.Unknown;
		case "PriceIntegrityBreach": return ManagedMonthlyBudgetReservationStates.PriceIntegrityBreach;
		case "Cancelled": return ManagedMonthlyBudgetReservationStates.Cancelled;
		default: throw new Error("Managed monthly budget found an unknown durable effect state");
	}
}
