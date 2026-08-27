import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDisposableDevelopmentCredentials, loadLocalDevelopmentSecrets, readOrCreateLocalSecret, removeDisposableDevelopmentCredentials } from "../local-development/secrets.mjs";
import { createLocalDevelopmentConfiguration } from "../local-development/configuration.mjs";
import { prepareLocalProviderConfiguration } from "../local-development/local-provider-configurations.mjs";
import { parseLocalDevelopmentArguments } from "../local-development/profiles.mjs";

const _PROVIDER_CONTRACT_PATH = new URL("../../libs/models/local-development/main/provider-contract.json", import.meta.url);

function _temporaryRepository()
{
	const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-local-test-"));
	fs.mkdirSync(path.join(repositoryRoot, "keys"), { recursive: true });
	fs.mkdirSync(path.join(repositoryRoot, "apps/_infra/litellm/local-development"), { recursive: true });
	const contractDirectory = path.join(repositoryRoot, "libs/models/local-development/main");
	fs.mkdirSync(contractDirectory, { recursive: true });
	fs.copyFileSync(_PROVIDER_CONTRACT_PATH, path.join(contractDirectory, "provider-contract.json"));
	return repositoryRoot;
}

function _prepareLocalConfiguration(repositoryRoot, argumentsList = ["--profile", "agent"])
{
	const configuration = createLocalDevelopmentConfiguration(parseLocalDevelopmentArguments(argumentsList), repositoryRoot, {});
	const prepared = prepareLocalProviderConfiguration(configuration);

	return {
		...configuration,
		...prepared
	};
}

test("generated master secrets are persisted with owner-only permissions", function _masterSecretPermissions(t)
{
	const repositoryRoot = _temporaryRepository();
	t.after(function _cleanup() { fs.rmSync(repositoryRoot, { recursive: true, force: true }); });
	const secretPath = path.join(repositoryRoot, "keys/.litellm-master-key");
	const randomBytes = function _fixedBytes() { return Buffer.alloc(32, 7); };
	const first = readOrCreateLocalSecret(secretPath, "Local LiteLLM master key", "sk-local-", randomBytes);
	const second = readOrCreateLocalSecret(secretPath, "Local LiteLLM master key", "sk-local-", function _mustNotRun() { throw new Error("unexpected regeneration"); });

	assert.equal(first, second);
	assert.match(first, /^sk-local-[0-9a-f]{64}$/);
	assert.equal(fs.statSync(secretPath).mode & 0o777, 0o600);
});

test("Alternative A reads the discovered provider file and keeps its master key separate", function _localSecrets(t)
{
	const repositoryRoot = _temporaryRepository();
	t.after(function _cleanup() { fs.rmSync(repositoryRoot, { recursive: true, force: true }); });
	fs.writeFileSync(path.join(repositoryRoot, "keys/.openai-key"), "provider-secret\n", { mode: 0o600 });
	const configuration = _prepareLocalConfiguration(repositoryRoot);
	const secrets = loadLocalDevelopmentSecrets(configuration, function _fixedBytes() { return Buffer.alloc(32, 3); });

	assert.equal(secrets.providerKey, "provider-secret");
	assert.notEqual(secrets.providerKey, secrets.liteLLMMasterKey);
});

test("Alternative A derives an owner-only provider-key file from the selected model", function _customLocalProviderKey(t)
{
	const repositoryRoot = _temporaryRepository();
	t.after(function _cleanup() { fs.rmSync(repositoryRoot, { recursive: true, force: true }); });
	fs.writeFileSync(path.join(repositoryRoot, "keys/.anthropic-key"), "custom-provider-secret\n", { mode: 0o600 });
	const configuration = _prepareLocalConfiguration(repositoryRoot, [
		"--profile",
		"agent",
		"--model",
		"anthropic/claude-sonnet-4-5-20250929"
	]);
	const secrets = loadLocalDevelopmentSecrets(configuration, function _fixedBytes() { return Buffer.alloc(32, 4); });

	assert.equal(secrets.providerKey, "custom-provider-secret");
	assert.equal(configuration.providerKeyPath, path.join(repositoryRoot, "keys/.anthropic-key"));
});

test("Alternative A reads only the selected provider credential", function _SelectedProviderOnly(t)
{
	const repositoryRoot = _temporaryRepository();
	t.after(function _cleanup() { fs.rmSync(repositoryRoot, { recursive: true, force: true }); });
	fs.writeFileSync(path.join(repositoryRoot, "keys/.anthropic-key"), "selected-secret\n", { mode: 0o600 });
	fs.writeFileSync(path.join(repositoryRoot, "keys/.openai-key"), "unselected-broad-secret\n", { mode: 0o644 });
	const configuration = _prepareLocalConfiguration(repositoryRoot, [
		"--profile",
		"agent",
		"--model",
		"anthropic/claude-sonnet-4-5-20250929"
	]);
	const secrets = loadLocalDevelopmentSecrets(configuration, function _fixedBytes() { return Buffer.alloc(32, 11); });

	assert.equal(configuration.selectedProvider, "anthropic");
	assert.equal(secrets.providerKey, "selected-secret");
});

test("Alternative A rejects a provider-key symlink to a managed credential", function _providerKeySymlink(t)
{
	const repositoryRoot = _temporaryRepository();
	t.after(function _cleanup() { fs.rmSync(repositoryRoot, { recursive: true, force: true }); });
	fs.symlinkSync(".local-postgres-password", path.join(repositoryRoot, "keys/.openai-key"));
	const configuration = _prepareLocalConfiguration(repositoryRoot);

	assert.throws(function _loadSymlink()
	{
		loadLocalDevelopmentSecrets(configuration, function _fixedBytes() { return Buffer.alloc(32, 5); });
	}, /must not be a symbolic link/);
});

test("Alternative A rejects a provider key equal to its PostgreSQL password", function _providerDatabaseCredentialReuse(t)
{
	const repositoryRoot = _temporaryRepository();
	t.after(function _cleanup() { fs.rmSync(repositoryRoot, { recursive: true, force: true }); });
	const repeatedBytes = Buffer.alloc(32, 6);
	const postgresPassword = `local-postgres-${repeatedBytes.toString("hex")}`;
	fs.writeFileSync(path.join(repositoryRoot, "keys/.openai-key"), `${postgresPassword}\n`, { mode: 0o600 });
	const configuration = _prepareLocalConfiguration(repositoryRoot);

	assert.throws(function _loadReusedCredential()
	{
		loadLocalDevelopmentSecrets(configuration, function _fixedBytes() { return repeatedBytes; });
	}, /must be different secrets/);
	assert.equal(fs.existsSync(configuration.localLiteLLMMasterKeyPath), false);
});

test("Alternative A rejects a LiteLLM master key equal to its PostgreSQL password", function _masterDatabaseCredentialReuse(t)
{
	const repositoryRoot = _temporaryRepository();
	t.after(function _cleanup() { fs.rmSync(repositoryRoot, { recursive: true, force: true }); });
	const repeatedBytes = Buffer.alloc(32, 8);
	const postgresPassword = `local-postgres-${repeatedBytes.toString("hex")}`;
	fs.writeFileSync(path.join(repositoryRoot, "keys/.openai-key"), "provider-secret\n", { mode: 0o600 });
	fs.writeFileSync(path.join(repositoryRoot, "keys/.litellm-master-key"), `${postgresPassword}\n`, { mode: 0o600 });
	const configuration = _prepareLocalConfiguration(repositoryRoot);

	assert.throws(function _loadReusedCredential()
	{
		loadLocalDevelopmentSecrets(configuration, function _fixedBytes() { return repeatedBytes; });
	}, /must be different secrets/);
});

test("Alternative B never falls back to the local generated master key", function _remoteSecrets(t)
{
	const repositoryRoot = _temporaryRepository();
	t.after(function _cleanup() { fs.rmSync(repositoryRoot, { recursive: true, force: true }); });
	fs.writeFileSync(path.join(repositoryRoot, "keys/remote-admin-key"), "remote-admin-secret\n", { mode: 0o600 });
	const configuration = createLocalDevelopmentConfiguration(parseLocalDevelopmentArguments([
		"--profile",
		"agent",
		"--alternative",
		"remote-llm",
		"--remote-litellm-endpoint",
		"https://litellm.example.test",
		"--remote-litellm-master-key-file",
		"keys/remote-admin-key"
	]), repositoryRoot, {});
	const secrets = loadLocalDevelopmentSecrets(configuration, function _fixedBytes() { return Buffer.alloc(32, 9); });

	assert.equal(secrets.liteLLMMasterKey, "remote-admin-secret");
	assert.equal(fs.existsSync(configuration.localLiteLLMMasterKeyPath), false);
});

test("secret files fail closed when another user class can read them", function _secretPermissions(t)
{
	const repositoryRoot = _temporaryRepository();
	t.after(function _cleanup() { fs.rmSync(repositoryRoot, { recursive: true, force: true }); });
	fs.writeFileSync(path.join(repositoryRoot, "keys/.openai-key"), "provider-secret\n", { mode: 0o644 });
	const configuration = _prepareLocalConfiguration(repositoryRoot);

	assert.throws(function _loadBroadSecret()
	{
		loadLocalDevelopmentSecrets(configuration, function _fixedBytes() { return Buffer.alloc(32, 1); });
	}, /must not be accessible/);
});

test("Alternative B rejects the provider key as its remote admin key", function _separateRemoteAdminKey(t)
{
	const repositoryRoot = _temporaryRepository();
	t.after(function _cleanup() { fs.rmSync(repositoryRoot, { recursive: true, force: true }); });
	fs.writeFileSync(path.join(repositoryRoot, "keys/.openai-key"), "provider-secret\n", { mode: 0o600 });
	const configuration = createLocalDevelopmentConfiguration(parseLocalDevelopmentArguments([
		"--profile",
		"agent",
		"--alternative",
		"remote-llm",
		"--remote-litellm-endpoint",
		"https://litellm.example.test",
		"--remote-litellm-master-key-file",
		"keys/.openai-key"
	]), repositoryRoot, {});

	assert.throws(function _loadProviderAsAdmin()
	{
		loadLocalDevelopmentSecrets(configuration, function _fixedBytes() { return Buffer.alloc(32, 1); });
	}, /separate from every reviewed local provider key/);
});

test("Alternative C does not read or generate provider and LiteLLM credentials", function _simulatedSecrets(t)
{
	const repositoryRoot = _temporaryRepository();
	t.after(function _cleanup() { fs.rmSync(repositoryRoot, { recursive: true, force: true }); });
	const configuration = createLocalDevelopmentConfiguration(parseLocalDevelopmentArguments([
		"--profile",
		"agent",
		"--alternative",
		"simulated-llm"
	]), repositoryRoot, {});
	const secrets = loadLocalDevelopmentSecrets(configuration, function _fixedBytes() { return Buffer.alloc(32, 5); });

	assert.ok(secrets.postgresPassword);
	assert.equal(configuration.providerKeyPath, undefined);
	assert.equal(fs.existsSync(configuration.localLiteLLMMasterKeyPath), false);
});

test("disposable development credentials are private and include a valid Ed25519 pair", function _developmentCredentials()
{
	const keyPaths = createDisposableDevelopmentCredentials();

	try
	{
		assert.equal(fs.statSync(keyPaths.directory).mode & 0o777, 0o700);
		assert.equal(fs.statSync(keyPaths.privateKeyPath).mode & 0o777, 0o600);
		assert.equal(fs.statSync(keyPaths.publicKeyPath).mode & 0o777, 0o600);
		assert.equal(fs.statSync(keyPaths.controllerTokenPath).mode & 0o777, 0o600);
		assert.equal(fs.statSync(keyPaths.runtimeLaunchSecretPath).mode & 0o777, 0o600);
		const runtimeLaunchSecret = fs.readFileSync(keyPaths.runtimeLaunchSecretPath, "utf8").trim();
		assert.ok(Buffer.byteLength(runtimeLaunchSecret) >= 32);
		assert.notEqual(fs.readFileSync(keyPaths.controllerTokenPath, "utf8").trim(), runtimeLaunchSecret);
		const message = Buffer.from("opencrane-local-membership");
		const signature = crypto.sign(null, message, fs.readFileSync(keyPaths.privateKeyPath));
		assert.equal(crypto.verify(null, message, fs.readFileSync(keyPaths.publicKeyPath), signature), true);
	}
	finally
	{
		removeDisposableDevelopmentCredentials(keyPaths);
	}

	assert.equal(fs.existsSync(keyPaths.directory), false);
});

test("core credentials omit unused Agent controller and runtime secrets", function _CoreCredentials()
{
	const keyPaths = createDisposableDevelopmentCredentials(false);

	try
	{
		assert.equal(fs.existsSync(path.join(keyPaths.directory, "private.pem")), true);
		assert.equal(fs.existsSync(path.join(keyPaths.directory, "public.pem")), true);
		assert.equal(fs.existsSync(path.join(keyPaths.directory, "controller.token")), false);
		assert.equal(fs.existsSync(path.join(keyPaths.directory, "runtime-launch.secret")), false);
	}
	finally
	{
		removeDisposableDevelopmentCredentials(keyPaths);
	}
});
