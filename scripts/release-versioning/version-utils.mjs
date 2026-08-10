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

/** Compare two strict semantic versions. */
export function compareSemver(left, right)
{
	const leftParts = parseSemver(left);
	const rightParts = parseSemver(right);
	for (let index = 0; index < leftParts.length; index += 1)
	{
		if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
	}
	return 0;
}

/** True only for the automatic adjacent minor-train transition. */
export function isAdjacentMinor(previous, current)
{
	const [previousMajor, previousMinor] = parseSemver(previous);
	const [currentMajor, currentMinor, currentPatch] = parseSemver(current);
	return previousMajor === currentMajor && currentMinor === previousMinor + 1 && currentPatch === 0;
}

/** Calculate the exact bytes digest recorded in a release manifest. */
export function sha256(path)
{
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}
