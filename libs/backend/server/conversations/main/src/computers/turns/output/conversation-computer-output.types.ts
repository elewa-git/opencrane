/** References one encrypted participant-facing payload without retaining its plaintext in history. */
export interface ConversationComputerOutputPayloadReference
{
	/** Identifies the private ciphertext row in the bound conversation. */
	readonly payloadRef: string;
	/** Binds history reads to the exact stored ciphertext. */
	readonly ciphertextDigest: string;
}

/** Holds the answer and optional display whose complete identity was saved in one SQL transaction. */
export interface ConversationComputerOutputPayload extends ConversationComputerOutputPayloadReference
{
	/** Identifies the primary Text block, preserving the existing answer and generated-file path. */
	readonly blockId: string;
	/** Holds the companion's encrypted content, or explicitly records that no display was returned. */
	readonly display: ConversationComputerOutputPayloadReference | null;
}
