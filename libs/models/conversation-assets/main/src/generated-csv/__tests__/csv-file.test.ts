import { describe, expect, it } from "vitest";

import { ___CreateCsvFile } from "../csv-file";
import { CsvFileCreationFailureCodes } from "../csv-file.types";

describe("CSV file generation", function _CsvFileGenerationSuite()
{
	it("renders deterministic RFC 4180 text and keeps negative numbers numeric", function _RendersCsv()
	{
		const result = ___CreateCsvFile({ displayName: "customer-report.csv", headers: ["Name", "Note", "Balance", "Active", "Optional"], rows: [["Amina", "Uses \"priority\", support", -12.5, true, null], ["Otieno", "plain", -0, false, ""]] });

		expect(result).toEqual({
			accepted: true,
			file: {
				displayName: "customer-report.csv",
				mediaType: "text/csv;charset=utf-8",
				text: "Name,Note,Balance,Active,Optional\r\nAmina,\"Uses \"\"priority\"\", support\",-12.5,true,\r\nOtieno,plain,0,false,\r\n",
				byteLength: 106,
			},
		});
	});

	it("counts generated UTF-8 bytes rather than JavaScript characters", function _CountsUtf8()
	{
		const result = ___CreateCsvFile({ displayName: "names.csv", headers: ["Name"], rows: [["Wanjikũ"]] });

		expect(result).toMatchObject({ accepted: true, file: { byteLength: Buffer.byteLength("Name\r\nWanjikũ\r\n", "utf8") } });
	});

	it.each([
		["path-like filename", { displayName: "../report.csv", headers: ["Name"], rows: [] }],
		["extra argument", { displayName: "report.csv", headers: ["Name"], rows: [], source: "secret" }],
		["duplicate header", { displayName: "report.csv", headers: ["Name", "Name"], rows: [] }],
		["unequal row width", { displayName: "report.csv", headers: ["Name", "Age"], rows: [["Amina"]] }],
		["control character", { displayName: "report.csv", headers: ["Name"], rows: [["line\nbreak"]] }],
		["formula after spaces", { displayName: "report.csv", headers: ["Name"], rows: [["  =HYPERLINK(\"bad\")"]] }],
		["formula-like header", { displayName: "report.csv", headers: ["+SUM(A1)"], rows: [] }],
		["non-finite number", { displayName: "report.csv", headers: ["Value"], rows: [[Number.POSITIVE_INFINITY]] }],
	])("rejects %s without reflecting input", function _RejectsInvalid(_label, value)
	{
		expect(___CreateCsvFile(value)).toEqual({ accepted: false, failureCode: CsvFileCreationFailureCodes.InvalidArguments });
	});

	it("rejects output that expands beyond one MiB", function _RejectsLargeOutput()
	{
		const rows = Array.from({ length: 300 }, function _Row() { return ["x".repeat(4_096)]; });

		expect(___CreateCsvFile({ displayName: "large.csv", headers: ["Value"], rows })).toEqual({ accepted: false, failureCode: CsvFileCreationFailureCodes.GeneratedOutputTooLarge });
	});

	it("enforces header, row, and total-cell ceilings before rendering", function _RejectsWorkLimits()
	{
		const headers = Array.from({ length: 65 }, function _Header(_value, index) { return `Column ${index}`; });
		const tooManyRows = Array.from({ length: 10_001 }, function _Row() { return [null]; });
		const wideHeaders = Array.from({ length: 64 }, function _Header(_value, index) { return `Column ${index}`; });
		const tooManyCells = Array.from({ length: 1_563 }, function _Row() { return Array.from({ length: 64 }, function _Cell() { return null; }); });

		expect(___CreateCsvFile({ displayName: "headers.csv", headers, rows: [] })).toMatchObject({ accepted: false });
		expect(___CreateCsvFile({ displayName: "rows.csv", headers: ["Value"], rows: tooManyRows })).toMatchObject({ accepted: false });
		expect(___CreateCsvFile({ displayName: "cells.csv", headers: wideHeaders, rows: tooManyCells })).toMatchObject({ accepted: false });
	});
});
