import { z } from "zod";

import type { GovernanceAccountBudget, GovernanceAccountBudgets, GovernanceAuditEntry, GovernanceAuditPage, GovernanceBudget, GovernanceTokenUsage, GovernanceTokenUsageRows } from "./governance-read.types";

/**
 * Validates untrusted reporting responses beside their generated-type aliases. Strict objects
 * match the public schemas and prevent undeclared response fields from reaching feature state.
 */
const _AuditEntrySchema: z.ZodType<GovernanceAuditEntry> = z.object({ timestamp: z.string().datetime({ offset: true }), tenant: z.string().optional(), action: z.string(), resource: z.string(), message: z.string() }).strict();

/** Checks both pagination fields together so an empty filtered page can still advance. */
export const ___GovernanceAuditPageSchema: z.ZodType<GovernanceAuditPage> = z.object({
	data: z.array(_AuditEntrySchema),
	pagination: z.object({ limit: z.number().int().min(1).max(1000), hasMore: z.boolean(), nextCursor: z.string().min(1).max(512).optional() }).strict(),
}).strict().refine(function _cursorMatchesContinuation(page)
{
	return page.pagination.hasMore === (page.pagination.nextCursor !== undefined);
}, { message: "Audit continuation is incomplete." });

/** Validates a configured ceiling without interpreting zero as missing or unlimited. */
export const ___GovernanceBudgetSchema: z.ZodType<GovernanceBudget> = z.object({ currency: z.string(), ceilingAmount: z.number().finite() }).strict();

/** Validates one configured account override. */
const _AccountBudgetSchema: z.ZodType<GovernanceAccountBudget> = z.object({ userId: z.string(), currency: z.string(), ceilingAmount: z.number().finite() }).strict();

/** Validates the complete override list, including an empty configured list. */
export const ___GovernanceAccountBudgetsSchema: z.ZodType<GovernanceAccountBudgets> = z.array(_AccountBudgetSchema);

/** Validates a recorded snapshot while preserving absent and zero ceilings distinctly. */
const _TokenUsageSchema: z.ZodType<GovernanceTokenUsage> = z.object({ userId: z.string(), inputTokens: z.number().int(), outputTokens: z.number().int(), totalTokens: z.number().int(), currency: z.string(), totalCost: z.number().finite(), budgetCeiling: z.number().finite().optional() }).strict();

/** Validates recorded usage without summing currencies or inventing a time interval. */
export const ___GovernanceTokenUsageRowsSchema: z.ZodType<GovernanceTokenUsageRows> = z.array(_TokenUsageSchema);
