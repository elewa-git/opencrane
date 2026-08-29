# Governed packages and container images

OpenCrane separates a product's stable identity and immutable revisions from the bytes or container
image that implement a revision. MCP servers and skills share governance and authorization, while
retaining the packaging and execution rules their domains need.

> See also: [Central authorization authority](/integrators/authorization-authority) (who may use a
> revision), [OCI MCP runtime](/integrators/oci-mcp-runtime) (MCP execution),
> [Agent skills](/guide/skills) (skill lifecycle), and
> [Governed agent runtime](/integrators/agent-runtime) (agent execution).

## Artifact, OCI image, and container

The words describe different things:

| Term | Meaning in OpenCrane | Stored in |
|---|---|---|
| `ArtifactRevision` | Immutable content bytes, such as a document, generated output, or skill bundle | ArtifactStore |
| OCI image | Runnable manifest, configuration, and filesystem layers identified by an immutable digest | OCI registry |
| Container | One running instance of an OCI image | Kubernetes Pod |

An OCI image is an artifact in general supply-chain language. In the OpenCrane data model,
`ArtifactRevision` specifically means content governed through ArtifactStore; it is not a container
image record. An OCI registry is therefore a storage and distribution substrate, not the product
catalogue or the authorization authority.

```text
ArtifactRevision                         OCI image
├── content address                      ├── image manifest digest
├── byte length                          ├── configuration digest
├── media type                           ├── filesystem layers
└── origin and scan state                └── entrypoint and platform
        │                                        │
        ▼                                        ▼
data loaded by a program                 runnable by a container runtime
```

## Current MCP model

An MCP upload begins as an OCI Image Layout ZIP held by an `ArtifactRevision`. Admission validates
the layout and descriptors, imports the image into the configured registry, and records the
immutable registry reference. Promotion creates an `McpServerRevision`; discovery then freezes its
MCP protocol version and tool schemas.

```text
ArtifactRevision containing OCI layout ZIP
        │
        ▼
OciImageValidation
├── index digest
├── manifest digest
├── configuration digest
└── registry reference
        │
        ▼
McpServerRevision
├── immutable registry reference
├── protocol version
└── McpToolRevision[]
        │
        ▼
AgentRevisionMcpToolAssignment
```

The temporary upload is content in ArtifactStore. The promoted MCP revision points at the runnable
image in the registry. An agent receives an exact tool revision, not general access to the image or
registry.

## Current skill model

A current `SkillRevision` is not an OCI image. It pins an immutable `ArtifactRevision` containing
instructions and, for sandboxed code, the reviewed source bundle.

```text
Skill
└── SkillRevision
    ├── manifest and requirements
    ├── trust class
    ├── review, test and scan evidence
    └── ArtifactRevision
             │
             ├── instruction skill ──► loaded by the agent runtime
             └── sandboxed code ─────► reviewed source bundle; execution runner 🔶
```

A code skill needs a runnable environment, but it does not always need its own image. The target
fixed runner supplies the reviewed language runtime, tools, entrypoint, and operating-system
packages; the `SkillRevision` supplies immutable skill content. The current architecture retains
the reviewed revision and validation records but has removed the retired tool-runner control plane,
so sandboxed code execution remains a locked follow-up rather than a shipped path.

## Skill execution classes

| Class | Revision content | Execution |
|---|---|---|
| Instruction skill | Instructions in an artifact bundle | Loaded into the current agent context or a fresh sub-context |
| Sandboxed code skill 🔶 | Reviewed code bundle in ArtifactStore | A future fixed OpenCrane runner image loads the bundle in an isolated Job |
| Containerized code skill 🔶 | Governed OCI image digest | Dedicated skill image plus a fixed OpenCrane companion |

Both code-execution classes are planned. A sandboxed bundle fits the fixed runner when its reviewed
runtime is sufficient. A containerized code skill is appropriate when the skill requires a
different language, native libraries, operating-system packages, custom binaries, or a server
process that the fixed runner must not absorb.

::: warning
A custom skill or MCP image never receives OpenCrane credentials. A fixed OpenCrane companion owns
the one-use workload claim, checks the local protocol, and reports the result.
:::

## Governed images and platform images

OpenCrane keeps two image classes separate even when an operator stores both in OCI registries:

```text
governed product images                 OpenCrane platform images
├── uploaded MCP server                 ├── agent runtime
└── containerized code skill 🔶         ├── MCP companion
                                        ├── skill authoring validator
                                        ├── skill execution runner 🔶
                                        ├── artifact scanner/preprocessor
                                        └── controller and server
```

A governed image belongs to a product revision that users and agents can discover, assign, publish,
use, or revoke. A platform image belongs to an OpenCrane release and implements a fixed execution or
control role. Sharing registry infrastructure does not merge those lifecycle records.

## Where authorization attaches

Authorization targets the product resource, never the blob or registry repository:

```text
AuthorizationGrant
        │ permits use of
        ▼
SkillRevision or McpToolRevision
        │ resolves immutable content
        ├── ArtifactRevision content address
        └── OCI image digest
                 │
                 ▼
ExecutionAdmission
├── Principal and run
├── product revision
├── arguments digest
├── execution profile
└── one workload assignment
```

The registry digest proves which bytes run. The authorization decision proves why that product
revision may run for that Principal. Workers receive a one-use admission and cannot choose another
revision or obtain a general registry credential.

Kubernetes workload identity proves which fixed companion, controller, or worker received that
admission. It still does not grant product access: the server binds the verified Pod and
ServiceAccount to the already admitted command before accepting a result.

## Source

- [`apps/opencrane/prisma/schema/artifacts.prisma`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/prisma/schema/artifacts.prisma)
- [`apps/opencrane/prisma/schema/mcp.prisma`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/prisma/schema/mcp.prisma)
- [`apps/opencrane/prisma/schema/skills.prisma`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/prisma/schema/skills.prisma)
- [`apps/opencrane/prisma/schema/agent-services.prisma`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/prisma/schema/agent-services.prisma)
