import { execFile } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { promisify } from "node:util";

const _EXEC_FILE = promisify(execFile);
const _GIB = 1_073_741_824;
const TIER3_MINIMUM_CAPACITY = Object.freeze({ cpu: 4, memoryGiB: 16, storageGiB: 32 });
const TIER3_RECOMMENDED_CAPACITY = Object.freeze({ cpu: 8, memoryGiB: 32, storageGiB: 64 });

/**
 * Measures CPU, memory, and the filesystem that holds the current checkout.
 * The coordinator reports these values before acquiring or deleting any host resource.
 * @returns The measured CPU count and memory, total storage, and available storage in GiB.
 */
export async function measureTier3Capacity(repositoryRoot, operations = {})
{
	const stat = operations.stat ?? async function _Stat(path)
	{
		const result = await _EXEC_FILE("df", ["-Pk", path]);
		const fields = result.stdout.trim().split("\n").at(-1).trim().split(/\s+/u);
		return { availableGiB: Number(fields[3]) * 1_024 / _GIB, totalGiB: Number(fields[1]) * 1_024 / _GIB };
	};
	const storage = await stat(repositoryRoot);
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
	if (measured.storageAvailableGiB < target.storageGiB) shortfalls.push(`${(target.storageGiB - measured.storageAvailableGiB).toFixed(1)} GiB more available storage required`);
	return shortfalls;
}
