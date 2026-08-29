import { OciRegistryImportErrorCodes } from "./oci-registry.types";

/**
 * Reports a registry import failure without including request headers or image bytes.
 *
 * The code separates retryable transport failures from invalid input and unsafe registry replies.
 * Called by: the OCI admission workflow through `OciRegistryClient.import`.
 */
export class OciRegistryImportError extends Error
{
	/** Stable category that lets the workflow decide whether another attempt can help. */
	readonly code: OciRegistryImportErrorCodes;
	/** HTTP status returned by the registry when a response was received. */
	readonly status?: number;
	/**
	 * Creates a credential-free failure for one import operation.
	 *
	 * @param code - Stable failure category.
	 * @param message - Plain explanation that contains no registry credentials or image bytes.
	 * @param status - Registry HTTP status when available.
	 */
	constructor(code: OciRegistryImportErrorCodes, message: string, status?: number)
	{
		super(message);
		this.name = "OciRegistryImportError";
		this.code = code;
		this.status = status;
	}
}
