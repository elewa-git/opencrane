# Artifacts — the content-addressed storage stack

> [backend](../README.md) › artifacts

An **artifact** is any stored file or output — a document, an image, a tool result — named by the
hash of its own bytes. That naming scheme is **CAS** (content-addressed storage): the file's name
*is* the fingerprint of its content, so identical content is stored once and a name can never point
at the wrong bytes. These five packages store artifacts safely, scan uploads, and derive bounded
text from PDFs: one decides *whether* a write is allowed, one lays the bytes down on disk, one runs
promotion, and two implement broker-only preprocessing and malware-scanning protocols.

## Map

| Package | What it owns |
| --- | --- |
| [`authorization`](./authorization/main/README.md) | Artifact write-lease and receipt authority. |
| [`filesystem`](./filesystem/main/README.md) | On-disk content-addressed store. |
| [`preprocessor`](./preprocessor/main/README.md) | PDF extraction and broker-only remote worker protocol. |
| [`preprocessor controller`](./preprocessor/controller/README.md) | Controller task definition that binds an isolated PDF worker before release. |
| [`preprocessor Job builder`](./preprocessor/k8s-launcher/README.md) | Hardened one-shot Job shape for a controller-started PDF worker. |
| [`preprocessor workflow contract`](./preprocessor/workflows/contract/README.md) | Shared saved-task name, retry policy, and identifier-only input for one PDF conversion. |
| [`scanner`](./scanner/main/README.md) | Fenced malware scanning with no storage or publication authority. |
| [`store`](./store/main/README.md) | Artifact promotion protocol and validation guards. |

```
   caller wants to store bytes
            │
            ▼
     authorization ....... hands out a write-lease, later a receipt
            │
            ▼
        store ............ stage → validate → promote (the protocol)
            │
            ▼
     filesystem .......... the one place the bytes actually live on disk

   OpenCrane broker ◄────► preprocessor
      source/output bytes   bounded scratch + PDF-to-text

   OpenCrane broker ◄────► scanner
         source bytes       clean / rejected only
```

## Dependency rule for this tier

The domain packages use `layer:backend` and `scope:artifacts`. The PDF controller, Job builder, and
workflow contract have smaller dedicated scopes because they cross the server/controller boundary.
ESLint enforces their one-way dependency rules: no package imports an app, and a worker never gains
database or storage authority through a controller dependency.

## See also

- Parent index: [`libs/backend`](../README.md)
- Sibling group: [`libs/backend/agents`](../agents/README.md) · artifact model: [`libs/models/artifacts`](../../models/artifacts/main/README.md)
