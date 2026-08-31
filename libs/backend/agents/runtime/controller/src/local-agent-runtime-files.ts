import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { LocalAgentRuntimeFiles } from "./local-process-agent-controller-store.types";

/** Create one private directory for a synthetic warm Pod. */
export async function _CreateLocalAgentRuntimeFiles(temporaryDirectoryRoot: string): Promise<LocalAgentRuntimeFiles>
{
	const directory = await mkdtemp(join(temporaryDirectoryRoot, "opencrane-warm-runtime-"));
	await chmod(directory, 0o700);
	return { directory, tokenPath: join(directory, "runtime.token"), proofEvidencePath: join(directory, "proof-evidence.json") };
}

/** Write one signed runtime bearer without making it visible to another local account. */
export async function _WriteLocalAgentRuntimeToken(files: LocalAgentRuntimeFiles, token: string): Promise<void>
{
	try
	{
		await writeFile(files.tokenPath, token, { encoding: "utf8", mode: 0o600, flag: "wx" });
		await chmod(files.tokenPath, 0o600);
	}
	catch (err)
	{
		await rm(files.directory, { recursive: true, force: true });
		throw err;
	}
}
