# @opencrane/platform — the web/desktop runtime seam

> [frontend](../README.md) › platform

## What it owns

This is a frontend **platform** package: the seam that isolates the one difference between running
in a browser and running in a future desktop shell. Some capabilities only exist on the desktop —
for example, picking a local folder from the native filesystem. Rather than let feature code branch
on "am I on desktop?", this package defines an abstract `PlatformBridge` interface, and features
program against that. Each app supplies the concrete implementation.

That indirection is the whole point: the web app binds the browser implementation, where
desktop-only methods report as unsupported; a future desktop app binds an Electron- or Tauri-backed
one — and **no feature code changes** either way.

```
 feature  ──inject(PLATFORM_BRIDGE)──►  PlatformBridge (interface)  ◄── HERE
                                              ▲
                        ┌─────────────────────┴─────────────────────┐
                  WebPlatformBridge                      (future) DesktopBridge
                  provideWebPlatform()  ← apps/opencrane-ui           Electron/Tauri
```

Invariant: this is the **only** place native or runtime APIs (Electron, Tauri, Node `fs`, `window`)
may appear. Keep them out of features, and the frontend stays portable across shells.

## Public surface

- `PlatformBridge` — the runtime-capability interface (`isDesktop`, `bindFolder(projectId)`) and its
  `BoundFolder` result type.
- `PLATFORM_BRIDGE` — the injection token features depend on.
- `provideWebPlatform()` — binds `WebPlatformBridge` (desktop-only methods reject as unsupported).

## Boundary

Consumed by feature packages (which inject the token) and by `apps/opencrane-ui` (which provides the
web implementation). It holds only the seam — no domain logic, no UI.

## Dependency direction

Tagged `scope:web` (the frontend dependency tier): it may import only other `scope:web` packages
and `scope:shared` contracts. In practice it depends on `@angular/core` alone and no other
`@opencrane` package.

## See also

- Parent index: [frontend](../README.md)
- Foundation: [core](../core/README.md)
