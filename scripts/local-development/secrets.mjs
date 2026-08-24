import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOCAL_DEVELOPMENT_ALTERNATIVES } from "./profiles.mjs";

function _readRequiredSecret(filePath, label)
{
	let secret;
	let statistics;

	try
	{
		statistics = fs.statSync(filePath);
		secret = fs.readFileSync(filePath, "utf8").trim();
	}
	catch (error)
	{
		if (error?.code === "ENOENT")
		{
			throw new Error(`${label} file is missing: ${filePath}`);
		}

		throw error;
	}

	if (!statistics.isFile())
	{
		throw new Error(`${label} path is not a regular file: ${filePath}`);
	}

	if ((statistics.mode & 0o077) !== 0)
	{
		throw new Error(`${label} file must not be accessible by group or other users: ${filePath}`);
	}

	if (!secret)
	{
		throw new Error(`${label} file is empty: ${filePath}`);
	}

	return secret;
}

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
		const providerKey = _readRequiredSecret(configuration.providerKeyPath, "OpenAI provider key");
		const liteLLMMasterKey = readOrCreateLocalSecret(configuration.localLiteLLMMasterKeyPath, "Local LiteLLM master key", "sk-local-", randomBytes);

		if (providerKey === liteLLMMasterKey)
		{
			throw new Error("The OpenAI provider key and LiteLLM master key must be different secrets");
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

	if (path.resolve(configuration.remoteLiteLLMMasterKeyPath) === path.resolve(configuration.providerKeyPath))
	{
		throw new Error("Alternative B requires a remote admin key file separate from the OpenAI provider key");
	}

	return {
		postgresPassword,
		liteLLMMasterKey: _readRequiredSecret(configuration.remoteLiteLLMMasterKeyPath, "Remote LiteLLM admin key")
	};
}

export function createDisposableDevelopmentCredentials(randomBytes = crypto.randomBytes)
{
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-local-membership-"));
	fs.chmodSync(directory, 0o700);
	const privateKeyPath = path.join(directory, "private.pem");
	const publicKeyPath = path.join(directory, "public.pem");
	const controllerTokenPath = path.join(directory, "controller.token");
	const runtimeLaunchSecretPath = path.join(directory, "runtime-launch.secret");
	const keyPair = crypto.generateKeyPairSync("ed25519");
	const privateKey = keyPair.privateKey.export({ type: "pkcs8", format: "pem" });
	const publicKey = keyPair.publicKey.export({ type: "spki", format: "pem" });
	fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600, flag: "wx" });
	fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o600, flag: "wx" });
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

export function removeDisposableDevelopmentCredentials(credentials)
{
	fs.rmSync(credentials.directory, { recursive: true, force: true });
}
