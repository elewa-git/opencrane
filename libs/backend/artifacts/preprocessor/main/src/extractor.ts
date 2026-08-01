import { spawn } from "node:child_process";

import type { PdfTextExtractor } from "./preprocessor.types.js";

/** Create the shell-free pdftotext adapter used by the worker's one conversion stage. */
export function _CreatePdfTextExtractor(): PdfTextExtractor
{
	return { extract: _ExtractPdfText };
}

/** Run the fixed Poppler conversion command with abort and wall-clock guards. */
async function _ExtractPdfText(sourcePath: string, outputPath: string, timeoutMilliseconds: number, signal: AbortSignal): Promise<void>
{
	if (signal.aborted) throw new Error("artifact preprocessing was aborted before conversion");
	await new Promise<void>(function _convert(resolve, reject)
	{
		const child = spawn("pdftotext", ["-enc", "UTF-8", "-nopgbrk", sourcePath, outputPath], { stdio: "ignore" });
		let settled = false;
		const timeout = setTimeout(function _timeout() { _Finish(new Error("pdftotext exceeded artifact preprocessor conversion timeout")); }, timeoutMilliseconds);
		function _Finish(error: Error | null): void
		{
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			signal.removeEventListener("abort", _Abort);
			if (error !== null)
			{
				child.kill("SIGKILL");
				reject(error);
				return;
			}
			resolve();
		}
		function _Abort(): void
		{
			_Finish(new Error("artifact preprocessing was aborted during conversion"));
		}
		child.once("error", function _error(err) { _Finish(err); });
		child.once("exit", function _exit(code, exitSignal)
		{
			if (code === 0) _Finish(null);
			else _Finish(new Error(`pdftotext failed with code ${code ?? "none"} and signal ${exitSignal ?? "none"}`));
		});
		signal.addEventListener("abort", _Abort, { once: true });
	});
}
