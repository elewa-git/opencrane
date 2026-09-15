import { execFile } from "node:child_process";
import { promisify } from "node:util";

const _EXEC_FILE = promisify(execFile);

/**
 * Reads the TLS Secret selected by the retained ingress Certificate instead of guessing its name.
 * The returned PEM becomes the local proxy's trust root for the current k3d ingress.
 * @returns The certificate stored in the Certificate-selected Secret.
 * @throws When the Certificate has no Secret reference or the Secret does not contain a PEM certificate.
 */
export async function readTier3IngressCertificate(options, operations = {})
{
	const kubectl = operations.kubectl ?? async function _Kubectl(arguments_) { return (await _EXEC_FILE("kubectl", arguments_)).stdout.trim(); };
	const secretName = await kubectl(["get", "certificate", options.certificateName, "-n", options.namespace, "-o", "jsonpath={.spec.secretName}"]);
	if (!secretName) throw new Error("Tier 3 ingress Certificate does not reference a Secret.");
	const encoded = await kubectl(["get", "secret", secretName, "-n", options.namespace, "-o", "jsonpath={.data.tls\\.crt}"]);
	const certificate = Buffer.from(encoded, "base64").toString("utf8");
	if (!/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/u.test(certificate)) throw new Error("Tier 3 ingress Secret contains an invalid TLS certificate.");
	return certificate;
}
