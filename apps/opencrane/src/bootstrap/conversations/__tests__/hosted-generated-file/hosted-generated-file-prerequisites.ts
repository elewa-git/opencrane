import { readFile } from "node:fs/promises";

import type { HostedGeneratedFilePrerequisites } from "./hosted-generated-file.types";

const _COORDINATE = /^[\x21-\x7e]{1,200}$/u;

/** Load the exact prerequisite coordinates produced by existing product owners. */
export async function __LoadHostedGeneratedFilePrerequisites(path: string): Promise<HostedGeneratedFilePrerequisites>
{
	const value: unknown = JSON.parse(await readFile(path, "utf8"));
	if (!_IsRecord(value))
		throw new Error("Hosted qualification prerequisites must be a JSON object");
	const allowed = ["personalAgentRef", "expectedModelDefinitionId", "expectedPrincipalId", "expectedSiloId"];
	if (Object.keys(value).some(key => !allowed.includes(key)) || allowed.some(key => typeof value[key] !== "string" || !_COORDINATE.test(value[key])))
		throw new Error("Hosted qualification prerequisites contain unsupported or missing coordinates");
	return {
		personalAgentRef: value["personalAgentRef"] as string,
		expectedModelDefinitionId: value["expectedModelDefinitionId"] as string,
		expectedPrincipalId: value["expectedPrincipalId"] as string,
		expectedSiloId: value["expectedSiloId"] as string,
	};
}

/** Return whether one JSON value has string-keyed properties. */
function _IsRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
