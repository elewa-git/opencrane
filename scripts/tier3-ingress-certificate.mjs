import { execFile } from "node:child_process";

/**
 * Reads the PEM certificate from the Secret selected by the deployed ingress Certificate.
 *
 * The browser proxy uses this material as its HTTPS CA set. Following the Certificate's
 * `spec.secretName` keeps trust bound to the resource that the smoke qualified; a missing resource,
 * an empty Secret reference, or non-PEM data stops the session before the proxy listens.
 *
 * Called by: `runTier3Development` after the current-silo smoke succeeds.
 *
 * @param {{ certificateName: string, namespace: string }} identity - Names the Certificate and its namespace.
 * @param {object} operations - Supplies the kubectl process operation replaced by tests.
 * @param {Function} [operations.execFile] - Executes each read-only kubectl lookup.
 * @returns {Promise<string>} The PEM certificate material used to verify ingress TLS.
 * @throws {Error} When kubectl cannot read either resource or the Secret does not contain a certificate.
 */
export function readTier3IngressCertificate(identity, operations = {})
{
	const runCommand = operations.execFile ?? execFile;

	return _RunKubectl(runCommand, [
		"get",
		"certificate",
		identity.certificateName,
		"-n",
		identity.namespace,
		"-o",
		"jsonpath={.spec.secretName}"
	], "Certificate").then(function _readSecret(secretName)
	{
		if (!secretName.trim())
		{
			throw new Error("The Tier 3 ingress Certificate does not name a TLS Secret.");
		}

		return _RunKubectl(runCommand, [
			"get",
			"secret",
			secretName.trim(),
			"-n",
			identity.namespace,
			"-o",
			"jsonpath={.data.tls\\.crt}"
		], "Secret");
	}).then(function _decode(encodedCertificate)
	{
		const certificate = Buffer.from(encodedCertificate.trim(), "base64").toString("utf8");

		if (!/^-----BEGIN CERTIFICATE-----/u.test(certificate))
		{
			throw new Error("The Tier 3 ingress Secret does not contain a PEM certificate.");
		}

		return certificate;
	});
}

/** Executes one read-only kubectl lookup and preserves its diagnostic output. */
function _RunKubectl(runCommand, argumentsList, resourceKind)
{
	return new Promise(function _run(resolve, reject)
	{
		runCommand("kubectl", argumentsList, function _finished(error, standardOutput, standardError)
		{
			if (error)
			{
				reject(new Error(`Unable to read the Tier 3 ingress ${resourceKind}: ${standardError.trim() || error.message}`));
				return;
			}

			resolve(standardOutput);
		});
	});
}
