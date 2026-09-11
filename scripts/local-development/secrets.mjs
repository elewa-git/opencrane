import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runLocalCommand } from "./command-runner.mjs";
import { LOCAL_DEVELOPMENT_ALTERNATIVES } from "./profiles.mjs";

/** Reads one non-empty credential from a private regular file. */
function readPrivateSecret(filePath, label)
{
	const statistics = fs.lstatSync(filePath);
	if (statistics.isSymbolicLink() || !statistics.isFile() || (statistics.mode & 0o077) !== 0)
	{
		throw new Error(`${label} must be a private regular file: ${filePath}`);
	}
	const value = fs.readFileSync(filePath, "utf8").trim();
	if (!value)
	{
		throw new Error(`${label} is empty: ${filePath}`);
	}
	return value;
}

/** Reads or creates one ignored credential that stays paired with persistent local data. */
function _persistentSecret(filePath, prefix, randomBytes)
{
	if (fs.existsSync(filePath))
	{
		return readPrivateSecret(filePath, "Tier 2 persistent credential");
	}
	fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
	const value = `${prefix}${randomBytes(32).toString("base64url")}`;
	fs.writeFileSync(filePath, `${value}\n`, { mode: 0o600, flag: "wx" });
	return value;
}

/** Reads or creates the payload keyring paired with the persistent local stores. */
function _persistentConversationKeyring(filePath, randomBytes)
{
	if (!fs.existsSync(filePath))
	{
		fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
		const document = { currentKeyId: "tier2-persistent", keys: { "tier2-persistent": randomBytes(32).toString("base64") } };
		fs.writeFileSync(filePath, `${JSON.stringify(document)}\n`, { mode: 0o600, flag: "wx" });
	}
	const document = JSON.parse(readPrivateSecret(filePath, "Tier 2 conversation keyring"));
	const key = document?.keys?.[document.currentKeyId];
	if (document.currentKeyId !== "tier2-persistent" || typeof key !== "string" || Buffer.from(key, "base64").byteLength !== 32)
	{
		throw new Error(`Tier 2 conversation keyring is invalid: ${filePath}`);
	}
	return filePath;
}

/** Writes one session credential into the private temporary directory. */
function _writeSecret(directory, name, value)
{
	const filePath = path.join(directory, name);
	fs.writeFileSync(filePath, `${value}\n`, { mode: 0o600, flag: "wx" });
	return filePath;
}

/** Creates the short-lived loopback certificate shared by KurrentDB and its clients. */
async function _createKurrentCertificate(configuration, directory, runCommand)
{
	const caCertificatePath = path.join(directory, "kurrentdb-ca.crt");
	const caPrivateKeyPath = path.join(directory, "kurrentdb-ca.key");
	const certificateRequestPath = path.join(directory, "kurrentdb.csr");
	const certificateExtensionsPath = path.join(directory, "kurrentdb-extensions.conf");
	const serverCertificatePath = path.join(directory, "kurrentdb.crt");
	const privateKeyPath = path.join(directory, "kurrentdb.key");
	await runCommand("openssl", [
		"req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
		"-subj", "/CN=OpenCrane Tier 2 local CA",
		"-addext", "basicConstraints=critical,CA:TRUE",
		"-addext", "keyUsage=critical,keyCertSign,cRLSign",
		"-keyout", caPrivateKeyPath,
		"-out", caCertificatePath
	], { signal: configuration.abortSignal });
	await runCommand("openssl", [
		"req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost",
		"-keyout", privateKeyPath, "-out", certificateRequestPath
	], { signal: configuration.abortSignal });
	fs.writeFileSync(certificateExtensionsPath, [
		"basicConstraints=critical,CA:FALSE",
		"keyUsage=critical,digitalSignature,keyEncipherment",
		"extendedKeyUsage=serverAuth",
		`subjectAltName=DNS:localhost,IP:127.0.0.1,DNS:${configuration.kurrentContainerName}`,
		""
	].join("\n"), { mode: 0o600, flag: "wx" });
	await runCommand("openssl", [
		"x509", "-req", "-days", "2", "-sha256",
		"-in", certificateRequestPath,
		"-CA", caCertificatePath,
		"-CAkey", caPrivateKeyPath,
		"-CAcreateserial",
		"-extfile", certificateExtensionsPath,
		"-out", serverCertificatePath
	], { signal: configuration.abortSignal });
	fs.chmodSync(privateKeyPath, 0o600);
	fs.chmodSync(serverCertificatePath, 0o644);
	fs.chmodSync(caCertificatePath, 0o644);
	return { caCertificatePath, privateKeyPath, serverCertificatePath };
}

/** Creates persistent service credentials plus disposable TLS and application-session secrets. */
export async function createLocalDevelopmentSecrets(configuration, operations = {})
{
	const randomBytes = operations.randomBytes ?? crypto.randomBytes;
	const runCommand = operations.runCommand ?? runLocalCommand;
	const makeTemporaryDirectory = operations.makeTemporaryDirectory ?? fs.mkdtempSync;
	const directory = makeTemporaryDirectory(path.join(os.tmpdir(), "opencrane-tier2-"));
	fs.chmodSync(directory, 0o700);
	try
	{
		const postgresPassword = _persistentSecret(path.join(configuration.persistentSecretsDirectory, "postgres-password"), "postgres-", randomBytes);
		const kurrentAdminPassword = _persistentSecret(path.join(configuration.persistentSecretsDirectory, "kurrent-admin-password"), "admin-", randomBytes);
		const kurrentOpsPassword = _persistentSecret(path.join(configuration.persistentSecretsDirectory, "kurrent-ops-password"), "ops-", randomBytes);
		const kurrentHistoryPassword = _persistentSecret(path.join(configuration.persistentSecretsDirectory, "kurrent-history-password"), "history-", randomBytes);
		const conversationKeyringPath = _persistentConversationKeyring(path.join(configuration.persistentSecretsDirectory, "conversation-keyring.json"), randomBytes);
		const certificate = await _createKurrentCertificate(configuration, directory, runCommand);
		const browserSessionCredential = randomBytes(32).toString("base64url");
		const browserSessionCredentialPath = _writeSecret(directory, "browser-session-credential", browserSessionCredential);
		let liteLLMMasterKey;
		if (configuration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM)
		{
			liteLLMMasterKey = `sk-local-${randomBytes(32).toString("base64url")}`;
		}
		if (configuration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.RemoteLiteLLM)
		{
			if (configuration.modelCredentials?.kind !== "remote")
			{
				throw new Error("Remote LiteLLM requires a validated administrator credential");
			}
			liteLLMMasterKey = configuration.modelCredentials.remoteMasterKey;
		}
		return {
			browserSessionCredential,
			browserSessionCredentialPath,
			directory,
			postgresPassword,
			kurrentAdminPassword,
			kurrentOpsPassword,
			kurrentHistoryPassword,
			kurrentAdminPasswordPath: _writeSecret(directory, "kurrent-admin-password", kurrentAdminPassword),
			kurrentHistoryUsernamePath: _writeSecret(directory, "kurrent-history-username", "opencrane-history"),
			kurrentHistoryPasswordPath: _writeSecret(directory, "kurrent-history-password", kurrentHistoryPassword),
			invitationSigningKeyPath: _writeSecret(directory, "invitation-signing.key", randomBytes(32).toString("base64url")),
			conversationKeyringPath,
			liteLLMMasterKey,
			liteLLMMasterAuthorizationHeaderPath: liteLLMMasterKey ? _writeSecret(directory, "litellm-master-authorization-header", `Authorization: Bearer ${liteLLMMasterKey}`) : undefined,
			...certificate
		};
	}
	catch (error)
	{
		fs.rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}

/** Deletes every session-only credential after child processes and containers stop. */
export function removeLocalDevelopmentSecrets(secrets)
{
	fs.rmSync(secrets.directory, { recursive: true, force: true });
}

/** Deletes credentials paired with stores that were explicitly reset. */
export function removePersistentLocalDevelopmentSecrets(configuration)
{
	fs.rmSync(configuration.persistentSecretsDirectory, { recursive: true, force: true });
}
