import { spawn } from "node:child_process";

import { ArtifactScannerVerdict } from "@opencrane/contracts";

import type { ArtifactMalwareScanner } from "./scanner.types";

/** Create a shell-free ClamAV adapter using the image-pinned offline definitions. */
export function _CreateClamAvScanner(executablePath: string, databasePath: string, version: string): ArtifactMalwareScanner
{
	return {
		version,
		scan(sourcePath, timeoutMilliseconds, signal)
		{
			return _Scan(executablePath, databasePath, sourcePath, timeoutMilliseconds, signal);
		}
	};
}

/** Run clamscan with fixed arguments and map only documented exit codes. */
async function _Scan(executablePath: string, databasePath: string, sourcePath: string, timeoutMilliseconds: number, signal: AbortSignal): Promise<ArtifactScannerVerdict>
{
	return new Promise<ArtifactScannerVerdict>(function _scan(resolve, reject)
	{
		const child = spawn(executablePath, ["--database", databasePath, "--no-summary", "--infected", sourcePath], { shell: false, stdio: "ignore" });
		const timeout = setTimeout(function _timeout() { child.kill("SIGKILL"); reject(new Error("artifact scan timed out")); }, timeoutMilliseconds);
		function _Abort(): void { child.kill("SIGKILL"); reject(signal.reason); }
		signal.addEventListener("abort", _Abort, { once: true });
		child.once("error", reject);
		child.once("close", function _closed(code)
		{
			clearTimeout(timeout);
			signal.removeEventListener("abort", _Abort);
			if (code === 0) resolve(ArtifactScannerVerdict.Clean);
			else if (code === 1) resolve(ArtifactScannerVerdict.Rejected);
			else reject(new Error("artifact scanner failed"));
		});
	});
}
