import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOCAL_DEVELOPMENT_ALTERNATIVES } from "./profiles.mjs";

/**
 * Reads a credential after `lstat` confirms the path is a regular file with no group or other access.
 * This check rejects a configured provider path that already points at another managed credential.
 * @param {string} filePath - Credential file to inspect and read.
 * @param {string} label - Credential name included in validation errors.
 * @returns {string} The trimmed, non-empty credential.
 * @throws When the path is missing, linked, not a regular private file, empty, or unreadable.
 */
function _readRequiredSecret(filePath, label)
{
	let secret;
	let statistics;

	try
	{
		statistics = fs.lstatSync(filePath);
	}
	catch (error)
	{
		if (error?.code === "ENOENT")
		{
			throw new Error(`${label} file is missing: ${filePath}`);
		}

		throw error;
	}

	if (statistics.isSymbolicLink())
	{
		throw new Error(`${label} path must not be a symbolic link: ${filePath}`);
	}

	if (!statistics.isFile())
	{
		throw new Error(`${label} path is not a regular file: ${filePath}`);
	}

	if ((statistics.mode & 0o077) !== 0)
	{
		throw new Error(`${label} file must not be accessible by group or other users: ${filePath}`);
	}

	secret = fs.readFileSync(filePath, "utf8").trim();

	if (!secret)
	{
		throw new Error(`${label} file is empty: ${filePath}`);
	}

	return secret;
}

/** Creates an owner-readable local secret or validates the permissions of the existing file. */
export function readOrCreateLocalSecret(filePath, label, prefix, randomBytes = crypto.randomBytes)
{
	if (fs.existsSync(filePath))
	{
		return _readRequiredSecret(filePath, label);
	}

	fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
	const secret = `${prefix}${randomBytes(32).toString("hex")}`;
	fs.writeFileSync(filePath, `${secret}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
	return secret;
}

/**
 * Loads the credentials required by the selected profile without reading keys used by other alternatives.
 * Local mode rejects pairwise reuse because the provider, LiteLLM proxy, and PostgreSQL database
 * authenticate different boundaries. Alternative B also refuses the local LiteLLM master-key and
 * configured provider-key paths as its remote admin-key source.
 *
 * Called by: `runLocalDevelopmentSession` before it creates commands or starts child processes.
 * @param {ReturnType<typeof import("./configuration.mjs").createLocalDevelopmentConfiguration>} configuration - Selected Tier 2 profile and credential paths.
 * @param {(size: number) => Buffer} randomBytes - Entropy source used when a managed local secret is absent.
 * @returns The credentials used by the selected profile.
 * @throws When a required credential file fails validation or when two boundaries reuse one credential.
 */
export function loadLocalDevelopmentSecrets(configuration, randomBytes = crypto.randomBytes)
{
	const postgresPasswordPath = path.join(configuration.repositoryRoot, "keys/.local-postgres-password");
	const postgresPassword = readOrCreateLocalSecret(postgresPasswordPath, "Local PostgreSQL password", "local-postgres-", randomBytes);

	if (configuration.profile === "core" || configuration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.Simulated)
	{
		return { postgresPassword };
	}

	if (configuration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM)
	{
		const providerKey = _readRequiredSecret(configuration.providerKeyPath, "Selected local provider key");

		if (providerKey === postgresPassword)
		{
			throw new Error("The selected local provider key and local PostgreSQL password must be different secrets");
		}

		const liteLLMMasterKey = readOrCreateLocalSecret(configuration.localLiteLLMMasterKeyPath, "Local LiteLLM master key", "sk-local-", randomBytes);

		if (providerKey === liteLLMMasterKey)
		{
			throw new Error("The selected local provider key and LiteLLM master key must be different secrets");
		}

		if (liteLLMMasterKey === postgresPassword)
		{
			throw new Error("The local LiteLLM master key and PostgreSQL password must be different secrets");
		}

		return {
			postgresPassword,
			providerKey,
			liteLLMMasterKey
		};
	}

	if (path.resolve(configuration.remoteLiteLLMMasterKeyPath) === path.resolve(configuration.localLiteLLMMasterKeyPath))
	{
		throw new Error("Alternative B requires a remote admin key file separate from the generated local LiteLLM key");
	}

	if (configuration.reviewedProviderKeyPaths.some(providerKeyPath => path.resolve(configuration.remoteLiteLLMMasterKeyPath) === path.resolve(providerKeyPath)))
	{
		throw new Error("Alternative B requires a remote admin key file separate from every reviewed local provider key");
	}

	return {
		postgresPassword,
		liteLLMMasterKey: _readRequiredSecret(configuration.remoteLiteLLMMasterKeyPath, "Remote LiteLLM admin key")
	};
}

/**
 * Creates a private temporary membership keypair and, for Agent profiles, separate controller credentials.
 * The coordinator removes the containing directory during shutdown.
 */
export function createDisposableDevelopmentCredentials(includeAgentCredentials = true, randomBytes = crypto.randomBytes)
{
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-local-membership-"));
	fs.chmodSync(directory, 0o700);
	const privateKeyPath = path.join(directory, "private.pem");
	const publicKeyPath = path.join(directory, "public.pem");
	const keyPair = crypto.generateKeyPairSync("ed25519");
	const privateKey = keyPair.privateKey.export({ type: "pkcs8", format: "pem" });
	const publicKey = keyPair.publicKey.export({ type: "spki", format: "pem" });
	fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600, flag: "wx" });
	fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o600, flag: "wx" });

	if (!includeAgentCredentials)
	{
		return {
			directory,
			privateKeyPath,
			publicKeyPath
		};
	}

	const controllerTokenPath = path.join(directory, "controller.token");
	const runtimeLaunchSecretPath = path.join(directory, "runtime-launch.secret");
	fs.writeFileSync(controllerTokenPath, `local-controller-${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
	fs.writeFileSync(runtimeLaunchSecretPath, `${randomBytes(32).toString("base64url")}\n`, { mode: 0o600, flag: "wx" });

	return {
		directory,
		privateKeyPath,
		publicKeyPath,
		controllerTokenPath,
		runtimeLaunchSecretPath
	};
}

/** Removes the temporary credential directory created for this Tier 2 session. */
export function removeDisposableDevelopmentCredentials(credentials)
{
	fs.rmSync(credentials.directory, { recursive: true, force: true });
}
