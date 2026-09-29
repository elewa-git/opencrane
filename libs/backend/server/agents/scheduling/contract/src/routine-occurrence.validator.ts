import { z } from "zod";

import { RoutineComputerActivationStatus, type RoutineComputerActivationReceipt, type RoutineComputerActivationResult, type RoutineOccurrencePreparationReceipt, type RoutineRunAdmissionReceipt } from "./routine-occurrence.types";

/** Accepts a nonblank saved identifier or opaque reference without changing it. */
const _ReferenceSchema = z.string().refine(function _IsReference(value): boolean { return value.trim().length > 0; });

/** Accepts the lowercase SHA-256 form written by occurrence adapters. */
const _DigestSchema = z.custom<`sha256:${string}`>(function _IsDigest(value): value is `sha256:${string}`
{
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
});

/** Validates a complete workflow task receipt without dropping unknown fields. */
const _WorkflowTaskReceiptSchema = z.object({
	taskId: _ReferenceSchema,
	taskName: _ReferenceSchema,
	idempotencyKey: _ReferenceSchema,
}).strict();

/** Validates the complete saved preparation receipt and rejects unknown fields. */
const _RoutineOccurrencePreparationReceiptSchema: z.ZodType<RoutineOccurrencePreparationReceipt> = z.object({
	receiptId: _ReferenceSchema,
	historyReference: _ReferenceSchema,
	digest: _DigestSchema,
}).strict();

/** Validates the complete saved activation receipt and rejects unknown fields. */
const _RoutineComputerActivationReceiptSchema: z.ZodType<RoutineComputerActivationReceipt> = z.object({
	receiptId: _ReferenceSchema,
	computerReference: _ReferenceSchema,
	digest: _DigestSchema,
}).strict();

/** Validates every activation poll outcome without dropping unknown fields. */
const _RoutineComputerActivationResultSchema: z.ZodType<RoutineComputerActivationResult> = z.discriminatedUnion("status", [
	z.object({ status: z.literal(RoutineComputerActivationStatus.Active), receipt: _RoutineComputerActivationReceiptSchema }).strict(),
	z.object({ status: z.literal(RoutineComputerActivationStatus.Pending), notBeforeEpochMs: z.number().int().safe().nonnegative(), expiresAtEpochMs: z.number().int().safe().nonnegative() }).strict(),
	z.object({ status: z.literal(RoutineComputerActivationStatus.Refused) }).strict(),
]).refine(function _HasBoundedWait(value): boolean
{
	return value.status !== RoutineComputerActivationStatus.Pending || value.notBeforeEpochMs <= value.expiresAtEpochMs;
});

/** Validates the complete run-admission checkpoint result and rejects unknown fields. */
const _RoutineRunAdmissionReceiptSchema: z.ZodType<RoutineRunAdmissionReceipt> = z.object({
	runId: _ReferenceSchema,
	inputSnapshotDigest: _DigestSchema,
	runTask: _WorkflowTaskReceiptSchema,
}).strict();

/** Restores a preparation receipt without converting or dropping saved evidence. */
export function ___ParseRoutineOccurrencePreparationReceipt(value: unknown): RoutineOccurrencePreparationReceipt
{
	const parsed = _RoutineOccurrencePreparationReceiptSchema.safeParse(value);
	if (!parsed.success)
	{
		throw new Error("routine preparation receipt is invalid");
	}
	return parsed.data;
}

/** Restores an activation receipt without converting or dropping saved evidence. */
export function ___ParseRoutineComputerActivationReceipt(value: unknown): RoutineComputerActivationReceipt
{
	const parsed = _RoutineComputerActivationReceiptSchema.safeParse(value);
	if (!parsed.success)
	{
		throw new Error("routine activation receipt is invalid");
	}
	return parsed.data;
}

/** Restores one complete activation poll outcome without converting saved timing or evidence. */
export function ___ParseRoutineComputerActivationResult(value: unknown): RoutineComputerActivationResult
{
	const parsed = _RoutineComputerActivationResultSchema.safeParse(value);
	if (!parsed.success)
	{
		throw new Error("routine computer activation result is invalid");
	}
	return parsed.data;
}

/** Restores a run-admission receipt without converting or dropping checkpoint evidence. */
export function ___ParseRoutineRunAdmissionReceipt(value: unknown): RoutineRunAdmissionReceipt
{
	const parsed = _RoutineRunAdmissionReceiptSchema.safeParse(value);
	if (!parsed.success)
	{
		throw new Error("routine run admission receipt is invalid");
	}
	return parsed.data;
}
