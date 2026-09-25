import { createHash } from "node:crypto";

import { __SignArtifactWriteLease, __VerifyArtifactPromotionReceipt } from "@opencrane/backend/artifacts/authorization";

import type { ArtifactUploadCryptoPort } from "../artifact-upload.types";
import { _ReadArtifactMountedPem } from "./artifact-mounted-key.loader";

/** Use the existing mounted keys for Artifact write leases and exact promotion receipt verification. */
export function _CreateArtifactUploadCryptoPort(environment: NodeJS.ProcessEnv = process.env): ArtifactUploadCryptoPort
{
	const leasePrivateKey = _ReadArtifactMountedPem(environment.ARTIFACT_LEASE_PRIVATE_KEY_PATH, "ARTIFACT_LEASE_PRIVATE_KEY_PATH");
	const receiptPublicKey = _ReadArtifactMountedPem(environment.ARTIFACT_RECEIPT_PUBLIC_KEY_PATH, "ARTIFACT_RECEIPT_PUBLIC_KEY_PATH");
	return {
		signLease(claims) { return __SignArtifactWriteLease(claims, leasePrivateKey, Math.floor(Date.now() / 1_000)); },
		verifyReceipt(compact) { return __VerifyArtifactPromotionReceipt(compact, receiptPublicKey); },
		digestReceipt(compact) { return `sha256:${createHash("sha256").update(compact, "utf8").digest("hex")}`; },
	};
}
