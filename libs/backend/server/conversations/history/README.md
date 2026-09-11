# @opencrane/backend/server/conversations/history — ordered participant history

> [backend](../../../README.md) › [server](../../README.md) › [conversations](../README.md) › history

## What it owns

This package reads and appends the immutable timeline that participants see. The participant
application checks current permissions first, then supplies trusted conversation coordinates.
The history owner validates each event against those coordinates and the expected stream position.

```text
participant authority ── authorised entry ──► history ◄── HERE
                                               │ checked append/read
                                               ▼
                                          history-store
```

**In this flow:** [participant authority](../main/README.md) · [history-store](../../infra/history-store/README.md).

A history conflict requires the caller to reload and recheck authority. Foreign-stream conflicts
and unavailable storage remain errors. Private text is encrypted against its silo, conversation,
author and payload reference; immutable events contain references and digests, never plaintext.

## Public surface

- `ConversationHistoryAuthority` and `ConversationHistoryReader` validate immutable genesis and timeline entries.
- `ConversationHistoryAuthority.appendWithAttestation` atomically records a service receipt and its participant-visible transformation, so uncertain retries can prove the exact entry without a second append.
- `BoundConversationWriter` prepares an exact output intent, then confirms or appends that saved intent against its admitted stream and lease binding.
- `AesGcmConversationPrivatePayloadCipher` and `_ReadConversationPrivatePayloadKeyring` load mounted keys and protect private text.
- The corresponding append, read, writer and cipher types define the caller's required evidence.

## Boundary

Current membership, product authorisation, database transactions and run admission belong to callers.
This package receives no Prisma client. A successful stream read or append cannot authorise an effect.
`timeline/`, `writing/` and `payloads/` keep event validation, computer stamping and encryption separate.

An attested append requires a new revision-zero receipt stream and an entry whose attestation names
that exact stream, event identifier and revision. Both records commit through one KurrentDB atomic
append. The caller still owns current recipient checks and complete receipt readback on recovery.

The caller saves the prepared `BoundConversationWriterIntent` before requesting append. On recovery,
the writer compares the complete event at the frozen next position. An identical accepted event
returns its original receipt; different history fails. A fresh physical append repeats current
visibility and authority checks. The caller must still verify the current Pod and lease before
recovery, and a history match never grants authority for another write.

## Dependency direction

Tagged `type:lib`, `layer:backend`, `scope:conversations`. It depends on shared contracts, pure
conversation models, observability and the `scope:history-store` port; it cannot import `main` or an app.

## Runtime & config

The caller supplies the history-store connection. Cipher creation requires a mounted keyring with
`currentKeyId` and base64url-encoded 256-bit `keys`; unreadable JSON or an absent current key fails startup.

Live history proofs run with `KURRENTDB_INTEGRATION_URL` through
`nx run backend-server-conversation-history:test:integration`. The participant package owns the
separate turn-and-answer recovery proof because it also exercises turn reservations.

## See also

- [Conversations](../README.md)
- [Participant authority](../main/README.md) · [Computer history](../computers/README.md)
