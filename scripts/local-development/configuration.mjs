import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { LOCAL_DEVELOPMENT_ALTERNATIVES } from "./profiles.mjs";

/** Hashes an absolute path into the short value stored on Docker ownership labels. */
function _identity(value)
{
	return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** Resolves the repository's shared Git directory from a checkout or linked worktree marker. */
function _repositoryGitDirectory(repositoryRoot)
{
	const markerPath = path.join(repositoryRoot, ".git");
	const statistics = fs.lstatSync(markerPath);

	if (statistics.isDirectory())
	{
		return fs.realpathSync(markerPath);
	}

	const marker = fs.readFileSync(markerPath, "utf8").trim();
	const prefix = "gitdir: ";

	if (!marker.startsWith(prefix))
	{
		throw new Error("The worktree .git marker is invalid");
	}

	const worktreeGitDirectory = fs.realpathSync(path.resolve(repositoryRoot, marker.slice(prefix.length)));
	const separator = `${path.sep}worktrees${path.sep}`;
	const worktreesIndex = worktreeGitDirectory.lastIndexOf(separator);
	return worktreesIndex < 0 ? worktreeGitDirectory : worktreeGitDirectory.slice(0, worktreesIndex);
}

/** Validates one loopback host port read from the environment. */
function _port(environment, name, defaultValue)
{
	const value = Number(environment[name] ?? defaultValue);

	if (!Number.isInteger(value) || value < 1024 || value > 65535)
	{
		throw new Error(`${name} must be an integer from 1024 to 65535`);
	}

	return value;
}

/** Resolves current release inputs and worktree-specific Docker resource names. */
export function createLocalDevelopmentConfiguration(parsed, repositoryRoot, environment = process.env)
{
	const realRoot = fs.realpathSync(repositoryRoot);
	const manifestPath = path.join(realRoot, "releases/0.11.0.json");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	const baselinePath = path.join(realRoot, manifest.database.baselinePath);
	const baselineDigest = crypto.createHash("sha256").update(fs.readFileSync(baselinePath)).digest("hex");

	if (baselineDigest !== manifest.database.baselineSha256)
	{
		throw new Error("The current target baseline does not match releases/0.11.0.json");
	}

	const repositoryIdentity = _identity(_repositoryGitDirectory(realRoot));
	const worktreeIdentity = _identity(realRoot);
	const suffix = `${repositoryIdentity.slice(0, 8)}-${worktreeIdentity.slice(0, 8)}`;
	const postgresPort = _port(environment, "OPENCRANE_LOCAL_POSTGRES_PORT", "54329");
	const kurrentPort = _port(environment, "OPENCRANE_LOCAL_KURRENTDB_PORT", "21139");
	const liteLLMPort = _port(environment, "OPENCRANE_LOCAL_LITELLM_PORT", "4000");
	const occupiedPorts = [postgresPort, kurrentPort, 4_200, 8_080, 8_081];

	if (parsed.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM && occupiedPorts.includes(liteLLMPort))
	{
		throw new Error("OPENCRANE_LOCAL_LITELLM_PORT must not collide with a Tier 2 port");
	}

	if (new Set(occupiedPorts).size !== occupiedPorts.length)
	{
		throw new Error("Tier 2 host ports must be distinct");
	}

	return {
		...parsed,
		repositoryRoot: realRoot,
		repositoryIdentity,
		worktreeIdentity,
		baselinePath,
		baselineDigest,
		seedPath: path.join(realRoot, "apps/opencrane/prisma/development/seed.sql"),
		kurrentBootstrapPath: path.join(realRoot, "apps/_infra/kurrentdb/helm/files/bootstrap.sh"),
		persistentSecretsDirectory: path.join(realRoot, "keys/tier2-local-development"),
		postgresImage: manifest.database.operandImage,
		kurrentImage: "docker.kurrent.io/kurrent-latest/kurrentdb@sha256:e5c9d59716174a4a47f9d54d6ce45aaaca48114b7ee668135aeb9f16934d74c8",
		liteLLMImage: "ghcr.io/berriai/litellm-non_root:main-v1.81.0-stable@sha256:39718a9cc9138c99ec812bcde24896411cf54502967a36b19897c539b796fdc7",
		postgresPort,
		kurrentPort,
		liteLLMPort,
		publicPort: 8_080,
		internalPort: 8_081,
		uiPort: 4_200,
		developmentProfile: parsed.profile === "core" ? "core" : `agent-${parsed.alternative.replace("-llm", "")}`,
		postgresContainerName: `opencrane-tier2-postgres-${suffix}`,
		kurrentContainerName: `opencrane-tier2-kurrentdb-${suffix}`,
		kurrentTlsProvisionerContainerName: `opencrane-tier2-kurrentdb-tls-${suffix}`,
		liteLLMContainerName: `opencrane-tier2-litellm-${suffix}`,
		postgresVolumeName: `opencrane-tier2-postgres-data-${suffix}`,
		kurrentVolumeName: `opencrane-tier2-kurrentdb-data-${suffix}`,
		kurrentTlsVolumeName: `opencrane-tier2-kurrentdb-tls-${suffix}`,
		networkName: `opencrane-tier2-${suffix}`,
		remoteLiteLLMMasterKeyFile: parsed.remoteLiteLLMMasterKeyFile ? path.resolve(realRoot, parsed.remoteLiteLLMMasterKeyFile) : undefined
	};
}
