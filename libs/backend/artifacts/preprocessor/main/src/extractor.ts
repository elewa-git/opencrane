import { spawn } from "node:child_process";

import type { PdfTextExtractor } from "./preprocessor.types.js";

/**
 * Build the PDF-to-text converter backed by Poppler's `pdftotext`.
 *
 * Spawned with a fixed argument list and no shell, so a filename can never be read as a command.
 * Each conversion has a wall-clock cap and is killed when it is exceeded or when the shutdown
 * signal fires.
 *
 * Called by: `apps/artifact-preprocessor/src/index.ts`.
 * @returns A converter matching {@link PdfTextExtractor}.
 */
export function _CreatePdfTextExtractor(): PdfTextExtractor
{
	return { extract: _ExtractPdfText };
}

/** Run `pdftotext` on one file, killing it if the timeout elapses or the shutdown signal fires, and throwing on a non-zero exit. */
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
