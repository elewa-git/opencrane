# @opencrane/backend/server/infra/conversation-payloads — private conversation payload encryption

> [OpenCrane](../../../../../README.md) › [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › conversation payloads

## What it owns

This package encrypts private ConversationComputer text and structured elicitation content before it
is stored outside immutable conversation history. The history stream retains only an opaque payload
reference and ciphertext digest.

```text
 server-validated payload
          │ plaintext only in server memory
          ▼
 ┌──────────────────────────────────┐
 │ private-payload cipher  ◄── HERE  │ dedicated rotating keyring + exact coordinates
 └────────────────┬─────────────────┘
                  ▼
             ciphertext row
```

**In this flow:** [conversations](../../conversations/main/README.md) ·
[ConversationComputer history](../../conversations/main/README.md#conversationcomputer)

## Public surface

- `MountedConversationPayloadCipher` encrypts and decrypts with AES-256-GCM from a dedicated
  Secret-mounted rotating keyring.
- `ConversationPayloadCipher` keeps conversation authorities independent of file and crypto APIs.
- `ConversationPayloadAssociatedData` binds every ciphertext to its silo, conversation, server-derived
  idempotency key, and verified plaintext digest.

## Boundary

The adapter never accepts `AgentRun`, attempt, continuation revision, or caller-selected payload
references. It authenticates only the target ConversationComputer payload identity. A copied row,
changed command key, altered digest, unavailable historic key, or malformed keyring fails closed;
neither plaintext nor a key is retained or logged.

## Dependency direction

Conversation authorities depend on the `ConversationPayloadCipher` port. This infrastructure package
depends only on Node file and cryptography APIs and does not import Prisma, AgentRun, or an app
composition root.

## Runtime and config

The OpenCrane server supplies the absolute read-only keyring mount through
`OPENCRANE_CONVERSATION_PAYLOAD_KEYRING_PATH`. Helm mounts a separate payload Secret so rotating or
retiring continuation keys cannot alter ConversationComputer payload confidentiality.

## See also

- Parent index: [server infrastructure](../README.md)
- History contract: [conversation entries](../../../../contracts/README.md)
