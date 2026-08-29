# External Storybook migration evidence

Migration date: 2026-08-29. No branch, worktree, commit, push, deployment or
workflow dispatch was created.

## Pre-mutation gate

- Storybook HEAD `48d17b07cf6d19d2d2ba28cc190ddf3a2430ae07`, clean
- restored DOM-native Navigation Tree: 11 focused tests pass
- direct rows, optional groups, disclosure/search, pointer/keyboard navigation,
  keyed identity, active/disabled/focus and bounded 1000-row projection verified
- old implementation had package launcher/scaffold and no declaration graph,
  PackageSession, WebSocket updates or last-good revision

## Migrated owners

| Old owner | Final exact packages | Leaves | Overviews | Routes |
|---|---|---:|---:|---:|
| `@engine/storybook` | `@engine/core` | 5 | 11 | 16 |
| `@ui/storybook` | `@ui/components`, `@zavx0z/dom` | 176 | 95 | 271 |
| `@nodes/storybook` | `@nodes/core`, `@nodes/editor`, `@nodes/layout`, `@nodes/worker`, `@nodes/ui` | 159 | 64 | 223 |
| `@quantum/storybook` | `@metafor/types`, `bulk` | 6 | 14 | 20 |
| hardcoded self app | `@zavx0z/storybook` | 14 | 24 | 38 |

The completed owner-migration baseline resolved four independently attached roots:
`workspace:webxr-space`, `project:renderer`, `project:metafor` and the standalone
`package:@zavx0z/storybook`. It contains 17 declarations, 11 packages, 574
nodes and 568 routes: 360 executable variants and 208 real overviews. Its
digest is
`095d5dfd901a496f471fef7dbdc792e660c05b7996e8dc22e3d808aad647fc49`.

The later MCP slice added search aliases only to the existing Storybook self
contract nodes (`MCP`, controller tools, watcher events and `lastWorking`). It
did not add declarations, nodes or routes. Direct resolution in the published
root order is now
`fb62d3f8075fd0f546a8a93f3f4019e678224b7b6141acffae459daea6783376`;
the long-lived server may report another digest when the same independent roots
were attached in a different preserved order.

All 17 manifests and 11 catalogs use the stable version-1 schema URLs under
`https://raw.githubusercontent.com/zavx0z/storybook/main/schemas/`.

## Route parity

Ordered baselines remain owner-owned in each project `.storybook` directory.
Leaf routes are exact; unknown routes fail closed and no overview falls back to
the first variant.

- Engine leaves SHA-256:
  `ccb020dbc8d92f40cbd01e72d1cf1ae0cd2f8f148c7a5735a811b990a7d503b3`
- UI pre-split leaves SHA-256:
  `2f9d9d438133bc9be48a56d872a6ff6be416f17c51234ac42ab93637989007f1`
- Node leaves SHA-256:
  `5ec797ff5b40c7ff276efc13e477db9a3e9a075457271e461758a3942fea9dd2`
- MetaFor leaves SHA-256:
  `cbe4b73cc8ae1cf792eb56fb3d5af3028b8a0c9fc4c6325d94393dd34ada0473`

UI's 176 leaves split exactly into 85 component-owned and 91 DOM-owned routes.
Its 215 old section-heavy overviews normalize to 95 package/category/subject
overviews through `.storybook/route-remap.json`. Node's 66 old overviews
normalize to 64 through `.storybook/overview-remap.json`. Section segments
remain explicit leaf route/grouping metadata and do not reintroduce a fourth
semantic navigation panel.

## Owner resource moves

- Engine declarations/runtime moved under `packages/core/.storybook`; the font
  and existing core story sources remain owned by `@engine/core`.
- UI production component stories and 14 reference SVG/provenance assets moved
  from the private package into `packages/components/.storybook`.
- The 91 DOM stories moved to their real Renderer owner at
  `renderer/packages/dom/.storybook`; Renderer production exports were not
  widened.
- Node catalogs/runtimes moved to each of the five real package owners; the
  Blender PNG/catalog remain resources of `@nodes/ui`.
- MetaFor Graph stories/fixtures moved to `types/.storybook`; Bulk HUD stories
  moved to `quantum/bulk/.storybook`. The Bulk adapter targets the current
  owner TSX `HudWindow`/`Timeline` WIP instead of restoring deleted legacy APIs.
- Storybook self documentation moved from the hardcoded `app` into the ordinary
  root package declaration `.storybook/manifest.json`.

Generated old-mode output was preserved recoverably, not treated as source:

- `/Users/zavx0z/.Trash/storybook-dist-package-mode-20260829`
- `/tmp/engine-storybook-dist.2u4CY4`
- `/Users/zavx0z/.Trash/node-packages-storybook-migration-20260829`
- `/tmp/metafor-quantum-storybook.gQgOWN/dist`

## Removed consumer mode

The active private directories `engine/packages/storybook`,
`ui/packages/storybook`, `node/packages/storybook` and
`metafor/quantum/storybook` are gone. Consumer workspaces/locks contain no
`@zavx0z/storybook` dependency, no old `@scope/storybook` package and no
package-local lifecycle wrapper. Canonical boundary scans report zero
violations for WebXR, Engine, UI, Node, Renderer, MetaFor and Interpreter, and
zero production story exports.

`layout-retired` was audited but deliberately not revived: it is disconnected
retired scope and still contains its historical 19 violations.

## Checks

- Storybook final `bun run check`: typecheck, 128 tests / 1020 assertions, and
  running-server self check; clean self session remained build-count stable
- P1 transaction/isolation regression slice: 38 tests / 203 assertions
- Engine: focused 8 / 64 assertions; deterministic `check:ci` 111 / 579;
  external package build pass
- UI: 64 / 452; external package build pass
- Node: 292 / 11068; all five external package builds pass
- Renderer DOM: 121 / 1079; external package build pass
- MetaFor focused Graph/Bulk/NodeTree: 168; final Graph 23 and Bulk 25;
  both external package builds pass
- WebXR workspace model: 15 / 54
- `git diff --check`: pass in every migrated checkout; staged files: zero

The strict WebXR pin check remains externally blocked by its pre-existing UI
gitlink and Renderer pin mismatch. MetaFor root typecheck remains externally
blocked by untouched Cosmos `createButton` WIP and dirty linked Renderer DOM
identities. Declaration resolution, owner builds and migration acceptance pass.

## Live acceptance

One foreground server stayed on one OS-assigned origin while the WebXR
workspace, standalone Renderer project, standalone MetaFor project, standalone
self package and standalone A/B/C fixture project were attached. The live graph
contained 21 declarations, 14 packages, 587 nodes and 580 routes with digest
`f06485be1bbbcf13090daf55a148e73cd1a18f8387ba1c5325b004a1718c3c47`.

- landing showed WebXR as a group and Renderer/MetaFor/self/isolation as direct
  rows; selecting Engine displayed package list and the true owner README
- Renderer DOM, UI Components, Node Editor, Engine and MetaFor opened as
  separate exact CDP tabs on the same origin; ready routes and console errors
  `0` were verified
- UI, Node and Renderer previews were non-empty; Engine's native canvas was
  2284x1984 and 304311 PNG bytes
- direct category -> subject overview -> variant navigation kept the same package
  `timeOrigin`; group collapse changed no route
- A-only update rebuilt/reloaded only A; B/C and landing revisions, build counts
  and `timeOrigin` stayed unchanged
- broken A produced `Unexpected end of file`, kept the visible last-good
  revision and local diagnostics, and did not reload B/C/landing
- restoring A cleared diagnostics and published a new revision; the controlled
  fixture file returned to its original SHA-256
  `344c3e54e22da700f1b53ce96995863f079b73edacfa40129785599331ae1ff4`

The accepted server and tabs were left running; no listener or browser process
owned by another task was stopped.

## MCP completion evidence

The Storybook MCP is now the sole agent interface. Its stdio adapter exposes
the 13 fixed `storybook_*` tools, two static resources and three resource
templates over the same `ExternalStorybookController` used by the human CLI.
It exposes opaque HMAC origin/view identities, never the loopback port, PID,
control capability, CDP target or artifact path.

Final static gates for the MCP slice: root `bun run check` passed 187 tests /
1420 assertions plus the self package build; MCP passed 7 protocol tests / 47
assertions. The WebXR declaration tests remained 15 / 54, while its strict
root check remains blocked only by the external Renderer pin drift documented
above.

Final real stdio E2E server identity:

- instance `2135c643-ff5d-4dc8-9004-1e82a4570db4`
- opaque origin `storybook-origin-v1_T9FkK0dLEja-IZjUH9PPmDwUyiPhN_Gs1CZ1QRcF79Y`
- four ready real views: Renderer DOM, UI Components, Node Editor and Engine
- MCP disconnect/reconnect preserved the same instance/origin and capture
  resource

Exact captures from that run:

| Area | Capture | Revision | Dimensions | SHA-256 |
|---|---|---|---:|---|
| UI preview | `capture_psKNZQCxySvxzWjRDt0vo624` | `9a9463e678fb4c412c839ac7` | 2284×1984 | `55587dc095eff7d0373e7633f43b9e858e83b310023ed9959becb332a8d5fd98` |
| Renderer Workbench | `capture_K0bxCcZmfWbB-33HmwPXHrfr` | `dc2da158e87615039d42b395` | 3840×2176 | `0f32196100e632a3ae4a89065b61b9f712358b860180001c54aaff5a83c88f93` |
| Engine canvas | `capture_ZhjuLaIY3i-g_o_9sGr_frGL` | `08afcf093d0304ce82ff2a28` | 2284×1984 | `05c3235720a78c2e8fa705f64da4e777253759fd9ce47bab0079e8ca6e8a70f7` |

Controlled A/B/C evidence:

- A `51a2fb0e3349d1c45b4fd47f → 219ee132d26786af07bea62d`
- failed A candidate `d268dcc48a4bf70449959654` preserved visible
  `lastWorking=219ee132d26786af07bea62d`
- recovery promoted `b08400ac35be4289be72fb2e` and cleared diagnostics
- B stayed `f57adffbb0f62b7bae876d48`; C stayed
  `a2609a6a352b59cf944787f5`
- fixture A returned byte-for-byte to
  `344c3e54e22da700f1b53ce96995863f079b73edacfa40129785599331ae1ff4`
- the temporary isolation root and A/B/C views were removed; the four real
  package tabs and canonical server remained running

After the final implementation-digest refresh, the current canonical server is
instance `479f3596-e951-49e0-a649-f03984ad174c`, opaque origin
`storybook-origin-v1_3fQDtTLnIbqJR8bBk8T0MJEQsbGcb6aqbGqPnyTHfYU`, with
11 packages and graph digest
`e817eb3f2f77ee71bd3594fe060c8ce4d69c23a7308121fb0fe2333533f30b2e`.
Its four current ready/presented revisions are DOM `5db3ad48a2c1dfd6ec771100`,
UI `08dcca9daf1d3760f574c80f`, Node Editor
`a78cd628c1922f6599102b5b` and Engine `b1caaf4128299cd161df365a`.
