import { describe, expect, it } from "vitest";

import { GovernanceReadError } from "../governance-read.error";
import { GovernanceReadErrorKinds } from "../governance-read.types";
import { ___GovernanceAccountBudgetsSchema, ___GovernanceAuditPageSchema, ___GovernanceBudgetSchema, ___GovernanceTokenUsageRowsSchema } from "../governance-read.validator";

/** Recorded usage fixture deliberately retains zero and a missing ceiling. */
const _USAGE = { userId: "account-1", inputTokens: 0, outputTokens: 2, totalTokens: 2, currency: "USD", totalCost: 0 };

describe("governance response validation", function _Validators()
{
	it("keeps an empty filtered audit page and its next cursor", function _FilteredPage()
	{
		const page = { data: [], pagination: { limit: 10, hasMore: true, nextCursor: "opaque-next-page" } };
		expect(___GovernanceAuditPageSchema.parse(page)).toEqual(page);
	});

	it("retains every public audit field and an omitted terminal cursor", function _AuditFields()
	{
		const entry = { timestamp: "2026-09-22T08:30:00.000Z", tenant: "optional-label", action: "Updated", resource: "Group/group-1", message: "The group changed." };
		const page = { data: [entry], pagination: { limit: 100, hasMore: false } };
		expect(___GovernanceAuditPageSchema.parse(page)).toEqual(page);
		expect(___GovernanceAuditPageSchema.parse(page).pagination).not.toHaveProperty("nextCursor");
	});

	it.each([
		{ limit: 10, hasMore: true },
		{ limit: 10, hasMore: false, nextCursor: "unexpected" },
		{ limit: 10, hasMore: false, nextCursor: null },
		{ limit: 10, hasMore: true, nextCursor: "" },
		{ limit: 10, hasMore: true, nextCursor: "x".repeat(513) },
		{ limit: 0, hasMore: false },
		{ limit: 1001, hasMore: false },
		{ limit: 1.5, hasMore: false },
	])("rejects incomplete or malformed audit pagination %#", function _InvalidPagination(pagination)
	{
		expect(___GovernanceAuditPageSchema.safeParse({ data: [], pagination }).success).toBe(false);
	});

	it.each([
		{ timestamp: "not-a-date", action: "Updated", resource: "group", message: "changed" },
		{ timestamp: "2026-09-22T08:30:00.000Z", action: "Updated", resource: "group" },
		{ timestamp: "2026-09-22T08:30:00.000Z", action: "Updated", resource: "group", message: "changed", secret: "must not enter state" },
	])("rejects malformed audit rows and undeclared fields %#", function _InvalidAuditEntry(entry)
	{
		expect(___GovernanceAuditPageSchema.safeParse({ data: [entry], pagination: { limit: 10, hasMore: false } }).success).toBe(false);
	});

	it("distinguishes zero ceilings from omitted ceilings across currencies", function _UsageFields()
	{
		const rows = [{ ..._USAGE, budgetCeiling: 0 }, { ..._USAGE, currency: "EUR", totalCost: 1.25 }];
		const parsed = ___GovernanceTokenUsageRowsSchema.parse(rows);
		expect(parsed).toEqual(rows);
		expect(parsed[0].budgetCeiling).toBe(0);
		expect(parsed[1]).not.toHaveProperty("budgetCeiling");
		expect(___GovernanceTokenUsageRowsSchema.parse([])).toEqual([]);
	});

	it.each([{ ..._USAGE, budgetCeiling: null }, { ..._USAGE, totalCost: Infinity }, { ..._USAGE, inputTokens: 1.5 }, { ..._USAGE, totalTokens: "2" }, { ..._USAGE, month: "September" }])("rejects unsupported usage values %#", function _InvalidUsage(row)
	{
		expect(___GovernanceTokenUsageRowsSchema.safeParse([row]).success).toBe(false);
	});

	it("accepts global zero and account overrides without interpreting their meaning", function _BudgetFields()
	{
		expect(___GovernanceBudgetSchema.parse({ currency: "USD", ceilingAmount: 0 })).toEqual({ currency: "USD", ceilingAmount: 0 });
		const accounts = [{ userId: "account-1", currency: "KES", ceilingAmount: 1250.5 }, { userId: "account-2", currency: "USD", ceilingAmount: 0 }];
		expect(___GovernanceAccountBudgetsSchema.parse(accounts)).toEqual(accounts);
		expect(___GovernanceAccountBudgetsSchema.parse([])).toEqual([]);
	});

	it("rejects missing, null and unexpected budget fields", function _InvalidBudgets()
	{
		expect(___GovernanceBudgetSchema.safeParse(null).success).toBe(false);
		expect(___GovernanceBudgetSchema.safeParse({ currency: "USD" }).success).toBe(false);
		expect(___GovernanceBudgetSchema.safeParse({ currency: "USD", ceilingAmount: null }).success).toBe(false);
		expect(___GovernanceAccountBudgetsSchema.safeParse([{ currency: "USD", ceilingAmount: 1 }]).success).toBe(false);
		expect(___GovernanceAccountBudgetsSchema.safeParse([{ userId: "account-1", currency: "USD", ceilingAmount: 1, secret: "hidden" }]).success).toBe(false);
	});

	it.each(Object.values(GovernanceReadErrorKinds))("constructs static safe copy for %s", function _ErrorCopy(kind)
	{
		const error = new GovernanceReadError(kind);
		expect(error).toMatchObject({ name: "GovernanceReadError", kind });
		expect(error.message.length).toBeGreaterThan(10);
		expect(error).not.toHaveProperty("cause");
	});
});
