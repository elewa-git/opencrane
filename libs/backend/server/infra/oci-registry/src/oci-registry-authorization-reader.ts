import { readFile } from "node:fs/promises";

/** Reads the mounted registry credential on each exchange so rotation needs no process restart. */
export function _CreateOciRegistryAuthorizationReader(path: string | undefined): (() => Promise<string>) | undefined
{
	return path === undefined ? undefined : async function _ReadAuthorization(): Promise<string>
	{
		return await readFile(path, "utf8");
	};
}
