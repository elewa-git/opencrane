import { GENERATED_CSV_MEDIA_TYPE, GENERATED_CSV_LIMITS } from "./csv-file-contract";
import { CsvFileCreationFailureCodes, type CreateCsvFileCommand, type CsvFileCell, type CsvFileCreationResult } from "./csv-file.types";

/** Rejects characters that can split records or hide data in common CSV readers. */
const _CONTROL_CHARACTERS = /\p{Cc}/u;
/** Rejects strings that spreadsheet programs can interpret as formulas after leading whitespace. */
const _FORMULA_LEADER = /^\s*[=+\-@]/u;
/** Accepts one ASCII basename and a `.csv` suffix without path separators. */
const _DISPLAY_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9 ._-]{0,122}[A-Za-z0-9_-])?\.csv$/u;

/** Validates unknown tool arguments and creates their deterministic RFC 4180 CSV. */
export function ___CreateCsvFile(value: unknown): CsvFileCreationResult
{
	const command = _ParseCommand(value);
	if (command === null)
		return { accepted: false, failureCode: CsvFileCreationFailureCodes.InvalidArguments };
	const records = [command.headers, ...command.rows];
	const chunks: string[] = [];
	let byteLength = 0;
	for (const record of records)
	{
		const rendered = `${record.map(_RenderCell).join(",")}\r\n`;
		byteLength += new TextEncoder().encode(rendered).byteLength;
		if (byteLength > GENERATED_CSV_LIMITS.generatedBytes)
			return { accepted: false, failureCode: CsvFileCreationFailureCodes.GeneratedOutputTooLarge };
		chunks.push(rendered);
	}
	return { accepted: true, file: { displayName: command.displayName, mediaType: GENERATED_CSV_MEDIA_TYPE, text: chunks.join(""), byteLength } };
}

/** Copies a strictly shaped command so later caller mutation cannot change the render. */
function _ParseCommand(value: unknown): CreateCsvFileCommand | null
{
	if (!_Record(value) || !_ExactKeys(value, ["displayName", "headers", "rows"]))
		return null;
	const displayName = value["displayName"];
	const headersValue = value["headers"];
	const rowsValue = value["rows"];
	if (typeof displayName !== "string" || displayName.length > GENERATED_CSV_LIMITS.displayNameCharacters || !_DISPLAY_NAME.test(displayName)
		|| !Array.isArray(headersValue) || headersValue.length < 1 || headersValue.length > GENERATED_CSV_LIMITS.headerCount
		|| !Array.isArray(rowsValue) || rowsValue.length > GENERATED_CSV_LIMITS.rowCount)
		return null;
	const headers: string[] = [];
	const uniqueHeaders = new Set<string>();
	for (const header of headersValue)
	{
		if (typeof header !== "string" || !_SafeString(header, GENERATED_CSV_LIMITS.headerBytes) || uniqueHeaders.has(header))
			return null;
		uniqueHeaders.add(header);
		headers.push(header);
	}
	const rows: CsvFileCell[][] = [];
	let cellCount = headers.length;
	for (const rowValue of rowsValue)
	{
		if (!Array.isArray(rowValue) || rowValue.length !== headers.length)
			return null;
		cellCount += rowValue.length;
		if (cellCount > GENERATED_CSV_LIMITS.cellCount)
			return null;
		const row: CsvFileCell[] = [];
		for (const cell of rowValue)
		{
			if (!_Cell(cell))
				return null;
			row.push(cell);
		}
		rows.push(row);
	}
	return { displayName, headers, rows };
}

/** Checks a string as UTF-8 bytes and refuses spreadsheet formula prefixes. */
function _SafeString(value: string, maximumBytes: number): boolean
{
	return value.length > 0 && new TextEncoder().encode(value).byteLength <= maximumBytes && !_CONTROL_CHARACTERS.test(value) && !_FORMULA_LEADER.test(value);
}

/** Accepts JSON scalar cells while treating negative numbers as numbers, never formula strings. */
function _Cell(value: unknown): value is CsvFileCell
{
	if (value === null || typeof value === "boolean")
		return true;
	if (typeof value === "number")
		return Number.isFinite(value);
	return typeof value === "string" && (value.length === 0 || _SafeString(value, GENERATED_CSV_LIMITS.stringCellBytes));
}

/** Applies RFC 4180 quoting after validation has removed record-breaking control characters. */
function _RenderCell(value: CsvFileCell): string
{
	if (value === null)
		return "";
	if (typeof value === "number")
		return Object.is(value, -0) ? "0" : String(value);
	if (typeof value === "boolean")
		return value ? "true" : "false";
	return /[,"]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Accepts a non-array object from parsed JSON. */
function _Record(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Requires the command to contain every named field and no extras. */
function _ExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean
{
	const actual = Object.keys(value).sort();
	const sortedExpected = [...expected].sort();
	return actual.length === sortedExpected.length && actual.every(function _Matches(key, index) { return key === sortedExpected[index]; });
}
