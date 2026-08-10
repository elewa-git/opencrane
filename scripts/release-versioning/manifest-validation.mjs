import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

/** Compile the checked-in release manifest schema once for a validation run. */
export function createReleaseManifestValidator(repositoryRoot)
{
	const schema = JSON.parse(readFileSync(join(repositoryRoot, "releases/release-manifest.schema.json"), "utf8"));
	const validate = new Ajv2020({ allErrors: true }).compile(schema);
	return (manifest, label = "release manifest") =>
	{
		if (validate(manifest)) return [];
		return (validate.errors ?? []).map((error) =>
			`${label} schema ${error.instancePath || "/"} ${error.message}`);
	};
}
