import { __ParseHostedGeneratedFileAsset, __ParseHostedGeneratedFileOciValidation, __ParseHostedGeneratedFileRun, __ParseHostedGeneratedFileToolSelection } from "./hosted-generated-file.validator";
import type { HostedGeneratedFileAsset, HostedGeneratedFileOciValidation, HostedGeneratedFileRun, HostedGeneratedFileToolSelection } from "./hosted-generated-file.types";

/** Narrow one untrusted JSON object. */
export function __HostedRecord(value: unknown): Record<string, unknown>
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("Hosted qualification response has an invalid object shape");
	return value as Record<string, unknown>;
}

/** Narrow one required response string. */
export function __HostedString(value: unknown, field: string): string
{
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`Hosted qualification response omitted ${field}`);
	return value;
}

/** Narrow one required response array. */
export function __HostedArray(value: unknown, field: string): readonly unknown[]
{
	if (!Array.isArray(value))
		throw new Error(`Hosted qualification response omitted ${field}`);
	return value;
}

/** Narrow one nonnegative finite response number. */
export function __HostedNumber(value: unknown, field: string): number
{
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		throw new Error(`Hosted qualification response omitted ${field}`);
	return value;
}

/** Parse one strict personal tool selection response. */
export function __HostedToolSelection(value: unknown): HostedGeneratedFileToolSelection
{
	return __ParseHostedGeneratedFileToolSelection(value);
}

/** Parse the browser-safe conversation asset projection. */
export function __HostedAsset(value: unknown): HostedGeneratedFileAsset
{
	return __ParseHostedGeneratedFileAsset(value);
}

/** Parse the public OCI validation evidence. */
export function __HostedValidation(value: unknown): HostedGeneratedFileOciValidation
{
	return __ParseHostedGeneratedFileOciValidation(value);
}

/** Parse one public owner-bound run projection. */
export function __HostedRun(value: unknown): HostedGeneratedFileRun
{
	return __ParseHostedGeneratedFileRun(value);
}
