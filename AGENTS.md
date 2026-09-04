# @zavx0z/storybook agent rules

## Workspace boundary

- The canonical primary checkout is
  `/Users/zavx0z/repozitarium/storybook`.
- Related canonical checkouts are
  `/Users/zavx0z/repozitarium/webxr-space`,
  `/Users/zavx0z/repozitarium/renderer`, and
  `/Users/zavx0z/repozitarium/metafor`.
- Never use `/Users/zavx0z/production` or another archival checkout.
- Preserve every supplied branch, dirty worktree, listener, browser target, and
  unrelated file. Do not create branches, clones, or worktrees without a new
  explicit owner request.

## Architecture process

- Start read-only. Before implementation, audit every existing Storybook and
  present one evidence-backed owner law and a staged migration plan.
- Node is a comparison candidate, not an assumed reference implementation.
- `@zavx0z/storybook` is an external dev tool. It does not become a central
  owner of other repositories' stories.
- A real package owns JSON declarations, semantic order, stories/resources,
  optional structural runtime and acceptance. Projects/workspaces are only
  saved compositions. The one global `$storybook` process owns registry,
  canonical graph, Workbench, PackageSessions, revisions, diagnostics and
  browser mechanics for exact production package identities.
- Consumer repositories and packages never depend on or import Storybook,
  including type-only imports. They own no Storybook process, port, server,
  build wrapper, launcher or private `@scope/storybook` package.
- Import exact owners directly. Do not add compatibility aliases, `paths`,
  wrappers, root barrels, generated copies, or compatibility re-exports.
- В сборке каждой страницы сохраняется по одной resolved identity для
  `@zavx0z/browser`, `@zavx0z/component`, `@zavx0z/dom`, `@zavx0z/engine`,
  `@zavx0z/layout`, `@zavx0z/nodes`, `@zavx0z/nodetree`, `@zavx0z/renderer`,
  `@zavx0z/space`, `@zavx0z/template`, `@zavx0z/ui` и `@zavx0z/webgpu`.
  Исторические package identities, compatibility aliases и
  generic Layout preview owners не возвращаются.
- Landing и каждая package page владеют ровно одним
  `@zavx0z/browser` Experience. Browser владеет его semantic Document, native
  Canvas, циклом кадров и вводом. Experience содержит exact
  `@zavx0z/space` `XRSpaceElement` и `XRViewPointElement`; package runtime не
  создаёт второй Experience или owner.
- Весь Workbench монтируется в одну HUD projection. Subject с
  `projection: "display"` монтируется в настоящий `XRDisplayElement`, subject с
  `projection: "hud"` — в `XRHUDElement`, а трёхмерный subject с
  `projection: "space"` — непосредственно в тот же `XRSpaceElement`. Допустимы
  только `display | hud | space`.
- Исполняемый package runtime использует exact marker `storybook-runtime/4`.
  Spatial runtime получает только `context.space` и `mountSpacePreview`;
  implementation objects Renderer и Browser остаются private.
- Шрифт страницы загружается через exact `@zavx0z/engine/default-font` и asset
  `@zavx0z/engine/fonts/inter-regular.ttf`; копии шрифта и запасные owner paths
  запрещены.
- This repository owns its own declaration-driven documentation. Every public contract,
  visible shared behavior, route rule, or example change updates the matching
  self-documentation page and executable example in the same slice. A change is
  not complete while `bun run check` leaves that documentation stale.
- Storybook MCP is the only agent control surface. Agents use `storybook_*`
  tools for lifecycle, search, views, wait, inspection, interaction and capture;
  they never call the Storybook CLI, browser scripts, ports or CDP identities.
- CLI remains a human/diagnostic adapter to the same
  `ExternalStorybookController`; MCP must never spawn or parse it.

## Self documentation lifecycle

- Self documentation is the ordinary root `.storybook/manifest.json` package
  declaration `@zavx0z/storybook`. It is attached to the same single external
  automatic-port server and does not compose stories owned by UI, Node, Engine,
  Renderer, or MetaFor.
- The root page is the same six-region WebGPU Workbench supplied to consumers.
  Every public subpath is a normal typed story in its catalog; live examples
  are variants inside that same route tree. Do not create a second DOM docs
  layout beside the shared Workbench.
- Package catalog JSON, current contracts and executable examples must remain
  aligned. A shared implementation change updates the matching self page.
- After a stable source checkpoint, use `storybook_check` and
  `storybook_wait`; do not restart the server or unrelated package views for a
  package implementation change.

## Delivery safety

- Storybook browser lifecycle is implemented inside Storybook MCP through its
  private direct-CDP controller. Never use `ai-macos`, `@meta/chrome`, a browser
  CLI/script or OS focus as a Storybook dependency or fallback.
- Do not push, create a pull request, deploy Pages, dispatch workflows, or
  create a GitHub repository without a separate explicit owner request.
- Do not stop the one existing external Storybook merely to inspect it. Use
  status/attach/check and preserve its registry, listener and package tabs.
- Automated captures are evidence candidates, not owner acceptance.
- TypeScript and JavaScript changes use no trailing semicolons unless syntax
  requires one.
