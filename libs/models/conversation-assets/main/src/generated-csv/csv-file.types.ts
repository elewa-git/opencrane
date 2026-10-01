/** One scalar value accepted in a generated CSV row. */
export type CsvFileCell = string | number | boolean | null;

/** Arguments accepted by the CSV renderer after validation. */
export interface CreateCsvFileCommand
{
	/** Browser-safe ASCII filename ending in `.csv`. */
	readonly displayName: string;
	/** Ordered, non-empty, unique column names. */
	readonly headers: readonly string[];
	/** Ordered rows whose widths equal the header count. */
	readonly rows: readonly (readonly CsvFileCell[])[];
}

/** A generated CSV whose UTF-8 length was checked before it left this package. */
export interface GeneratedCsvFile
{
	/** Filename copied from validated tool arguments, never from a resource URI. */
	readonly displayName: string;
	/** Media type returned in the embedded MCP resource. */
	readonly mediaType: string;
	/** Complete RFC 4180 text with CRLF record endings. */
	readonly text: string;
	/** Number of bytes in the UTF-8 encoding of `text`. */
	readonly byteLength: number;
}

/** Stable reasons why admitted-looking arguments did not produce a file. */
export enum CsvFileCreationFailureCodes
{
	/** The filename, header, row, or cell shape was outside the published tool schema. */
	InvalidArguments = "invalid_arguments",
	/** Correctly shaped input expanded beyond the generated-file byte ceiling. */
	GeneratedOutputTooLarge = "generated_output_too_large",
}

/** Result of validating arguments and rendering their CSV bytes. */
export type CsvFileCreationResult =
	| { readonly accepted: true; readonly file: GeneratedCsvFile }
	| { readonly accepted: false; readonly failureCode: CsvFileCreationFailureCodes };
