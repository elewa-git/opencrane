import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { readLocalProviderCatalog, resolveLocalProviderSelection } from "../../apps/_infra/litellm/local-development/provider-selection.mjs";

/** Environment variable understood by the launcher as the Tier 2 fallback provider. */
export const TIER2_DEFAULT_PROVIDER_ENVIRONMENT_VARIABLE = "OPENCRANE_TIER2_DEFAULT_PROVIDER";

/** Ignored repository-relative file that retains the workstation fallback between launches. */
export const WORKSTATION_PROVIDER_DEFAULT_FILE = "keys/.tier2-default-provider.env";

/** Resolves the ignored workstation file that retains the Tier 2 provider preference. */
function _preferencePath(repositoryRoot)
{
	return path.join(repositoryRoot, WORKSTATION_PROVIDER_DEFAULT_FILE);
}

/** Reads path metadata without following a symbolic link, returning nothing when absent. */
function _existingStatistics(filePath)
{
	try
	{
		return fs.lstatSync(filePath);
	}
	catch (error)
	{
		if (error.code === "ENOENT")
			return;

		throw error;
	}
}

/** Requires an existing preference path to be a private regular file. */
function _requirePrivateRegularFile(filePath, statistics)
{

	if (
		statistics.isSymbolicLink()
		|| !statistics.isFile()
		|| (statistics.mode & 0o077) !== 0
	)
	{
		throw new Error(`The Tier 2 provider preference must be a private regular file: ${filePath}`);
	}
}

/**
 * Reads the persisted workstation provider.
 *
 * @param {string} repositoryRoot - Real repository root containing the ignored `keys/` directory.
 * @returns {string | undefined} Reviewed lowercase provider name, or nothing when no preference exists.
 * @throws {Error} When the path is unsafe or its assignment is malformed or no longer reviewed.
 */
export function readWorkstationProviderDefault(repositoryRoot)
{
	const filePath = _preferencePath(repositoryRoot);
	const statistics = _existingStatistics(filePath);

	if (!statistics)
		return;

	_requirePrivateRegularFile(filePath, statistics);
	const content = fs.readFileSync(filePath, "utf8");
	const escapedName = TIER2_DEFAULT_PROVIDER_ENVIRONMENT_VARIABLE.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const match = new RegExp(`^${escapedName}=([a-z0-9]+(?:-[a-z0-9]+)*)\\r?\\n?$`, "u").exec(content);

	if (!match)
		throw new Error(`The Tier 2 provider preference is invalid: ${filePath}`);

	const provider = match[1];
	const reviewed = readLocalProviderCatalog().some((entry) => entry.name === provider);

	if (!reviewed)
		throw new Error(`The persisted Tier 2 provider ${provider} is not in the reviewed catalogue`);

	return provider;
}

/**
 * Validates and atomically persists the workstation provider selected by `--default-provider`.
 *
 * @param {string} repositoryRoot - Real repository root containing the provider key.
 * @param {string} provider - Reviewed lowercase provider name requested by the user.
 * @returns {string} Validated provider written to the owner-only preference file.
 * @throws {Error} When the provider key is missing or unsafe, or an existing preference path is unsafe.
 */
export function persistWorkstationProviderDefault(repositoryRoot, provider)
{
	const selection = resolveLocalProviderSelection({ repositoryRoot, defaultProvider: provider });
	const selectedProvider = selection.provider.name;
	const filePath = _preferencePath(repositoryRoot);
	const directory = path.dirname(filePath);
	const statistics = _existingStatistics(filePath);

	if (statistics)
		_requirePrivateRegularFile(filePath, statistics);

	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;

	try
	{
		const content = `${TIER2_DEFAULT_PROVIDER_ENVIRONMENT_VARIABLE}=${selectedProvider}\n`;
		fs.writeFileSync(temporaryPath, content, { flag: "wx", mode: 0o600 });
		fs.renameSync(temporaryPath, filePath);
		fs.chmodSync(filePath, 0o600);
	}
	finally
	{
		fs.rmSync(temporaryPath, { force: true });
	}

	return selectedProvider;
}
