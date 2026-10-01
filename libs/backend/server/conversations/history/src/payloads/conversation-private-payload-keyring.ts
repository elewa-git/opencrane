import { readFileSync } from "node:fs";

import type { ConversationPrivatePayloadKeyringDocument } from "./conversation-private-payload.types";

/** Reads and structurally narrows one Secret-mounted JSON keyring before the cipher validates its keys. */
export function _ReadConversationPrivatePayloadKeyring(path: string): ConversationPrivatePayloadKeyringDocument
{
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      "Conversation private payload keyring must be readable JSON",
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Conversation private payload keyring must be an object");
  const document = value as Record<string, unknown>;
  if (
    typeof document["currentKeyId"] !== "string" ||
    typeof document["keys"] !== "object" ||
    document["keys"] === null ||
    Array.isArray(document["keys"])
  )
    throw new Error(
      "Conversation private payload keyring must contain currentKeyId and keys",
    );
  for (const encoded of Object.values(
    document["keys"] as Record<string, unknown>,
  )) {
    if (typeof encoded !== "string")
      throw new Error(
        "Conversation private payload keyring keys must be encoded strings",
      );
  }
  return {
    currentKeyId: document["currentKeyId"],
    keys: document["keys"] as Record<string, string>,
  };
}
