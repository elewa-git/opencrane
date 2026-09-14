import { execFile } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { promisify } from "node:util";

const _EXEC_FILE = promisify(execFile);
const _GIB = 1_073_741_824;
const _STORAGE_PROBE_IMAGE = "busybox:1.36.1";
const TIER3_MINIMUM_CAPACITY = Object.freeze({ cpu: 4, memoryGiB: 16, storageGiB: 32 });
const TIER3_RECOMMENDED_CAPACITY = Object.freeze({ cpu: 8, memoryGiB: 32, storageGiB: 64 });

/**
 * Measures CPU, memory, and the Docker filesystem that will hold the k3d nodes and images.
 * The lightweight probe container sees Docker Desktop's VM disk as well as a local Linux daemon,
 * while the workstation checkout filesystem can be a different device.
 * @returns The measured CPU count and memory, total storage, and available storage in GiB.
 */
export async function measureTier3Capacity(operations = {})
{
	const storage = await (operations.measureStorage ?? _MeasureDockerStorage)(operations.execFile ?? _EXEC_FILE);
	return { cpu: (operations.cpus ?? cpus)().length, memoryGiB: (operations.totalmem ?? totalmem)() / _GIB, storageAvailableGiB: storage.availableGiB, storageGiB: storage.totalGiB };
}

/**
 * Compares a host measurement with the documented minimum and recommended Tier 3 profiles.
 * The result reports every shortfall and does not prune caches, images, or clusters to manufacture
 * capacity.
 * @returns The original measurements and separate minimum and recommended shortfall lists.
 */
export function classifyTier3Capacity(measured)
{
	return Object.freeze({ measured, minimumShortfalls: _Shortfalls(measured, TIER3_MINIMUM_CAPACITY), recommendedShortfalls: _Shortfalls(measured, TIER3_RECOMMENDED_CAPACITY) });
}

/**
 * Formats the measurements used for the capacity decision so a developer can verify any refusal.
 * @returns One human-readable line containing CPU, memory, total storage, and available storage.
 */
export function formatTier3Capacity(capacity)
{
	const measured = capacity.measured;
	return `Tier 3 host: ${measured.cpu} CPU, ${measured.memoryGiB.toFixed(1)} GiB memory, ${measured.storageGiB.toFixed(1)} GiB storage (${measured.storageAvailableGiB.toFixed(1)} GiB available)`;
}

function _Shortfalls(measured, target)
{
	const shortfalls = [];
	if (measured.cpu < target.cpu) shortfalls.push(`${target.cpu - measured.cpu} more CPU required`);
	if (measured.memoryGiB < target.memoryGiB) shortfalls.push(`${(target.memoryGiB - measured.memoryGiB).toFixed(1)} GiB more memory required`);
	if (measured.storageGiB < target.storageGiB) shortfalls.push(`${(target.storageGiB - measured.storageGiB).toFixed(1)} GiB more allocated storage required`);
	return shortfalls;
}

/** Measure the filesystem exposed to containers without reading an unrelated checkout device. */
async function _MeasureDockerStorage(execFileImplementation)
{
	const result = await execFileImplementation("docker", ["run", "--rm", "--pull=missing", "--network", "none", "--read-only", _STORAGE_PROBE_IMAGE, "df", "-Pk", "/"]);
	const fields = result.stdout.trim().split("\n").at(-1)?.trim().split(/\s+/u) ?? [];
	const totalKiB = Number(fields[1]);
	const availableKiB = Number(fields[3]);
	if (!Number.isFinite(totalKiB) || !Number.isFinite(availableKiB) || totalKiB <= 0 || availableKiB < 0)
		throw new Error("Tier 3 could not read Docker backing-storage capacity from its probe container.");
	return { availableGiB: availableKiB * 1_024 / _GIB, totalGiB: totalKiB * 1_024 / _GIB };
}
