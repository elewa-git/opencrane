import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const _SEMVER = /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)$/u;

/** Read and parse one trusted repository JSON file. */
export function readJson(path)
{
	return JSON.parse(readFileSync(path, "utf8"));
}

/** Parse strict, unprefixed semantic versions used by release manifests. */
export function parseSemver(version)
{
	const match = _SEMVER.exec(version);
	if (!match?.groups) throw new Error(`invalid semantic version '${version}'`);
	return [Number(match.groups.major), Number(match.groups.minor), Number(match.groups.patch)];
}

/** Calculate the exact bytes digest recorded in a release manifest. */
export function sha256(path)
{
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}
