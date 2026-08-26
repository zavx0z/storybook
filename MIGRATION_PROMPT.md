# Prompt: extract and standardize `@zavx0z/storybook`

You are working in a Codex local multi-folder project.

Primary repository:

- `/Users/zavx0z/repozitarium/storybook`

Secondary repositories:

- `/Users/zavx0z/repozitarium/webxr-space/projects/engine`
- `/Users/zavx0z/repozitarium/webxr-space/projects/layout`
- `/Users/zavx0z/repozitarium/webxr-space/projects/ui`
- `/Users/zavx0z/repozitarium/webxr-space/projects/node`
- `/Users/zavx0z/repozitarium/metafor`

## Owner objective

Create and migrate toward a shared private development package named
`@zavx0z/storybook` that brings all existing Storybooks to one coherent set of
architecture, routing, Workbench, lifecycle, build, and evidence laws.

Do not create one central catalog that takes ownership away from repositories
or packages. A repository, or a package with a genuinely separate lifecycle or
delivery boundary, keeps its own Storybook, stories, catalog descriptors,
preview state, process, routes, static output, references, and acceptance.
`@zavx0z/storybook` supplies reusable infrastructure used by those private
Storybook applications.

The current Node Storybook looks like the strongest candidate for comparison,
but it is not an accepted reference. Audit it against Engine, Layout, UI, and
MetaFor and prove which parts should become common law. Reject or replace Node
choices that are less correct than another owner implementation.

## Mandatory first phase: research and plan only

Do not edit any repository during the first phase.

Before repository research, verify that this Codex local project has the primary
`storybook` folder plus all five secondary repository folders listed above.
If folders are missing, use `$ai-macos` through direct
`mcp__ai_macos__*` tools to open **Edit project → Add folder** in the Codex
app and add only those exact canonical paths. First require passive
`system_health` with `machine.matchesExpected: true`; call
`input_readiness` only immediately before pointer/keyboard input. Do not use
the deprecated `ai-macos-local` connector, direct REST, or permission
endpoints. Capture and verify each UI state, and do not begin the audit until
the attached-folder set is exact.

1. Read every applicable `AGENTS.md`, repository architecture document,
   Storybook requirements, public types, package manifests, focused tests,
   lifecycle skills, server/build code, and Pages workflow.
2. Inspect the current Git branch, HEAD, status, links, and listener ownership
   in every repository before proposing changes.
3. Separate current implemented facts, owner laws, historical compatibility,
   assistant proposals, and remaining acceptance gates.
4. Produce a comparison matrix for Engine, Layout, UI, Node, and MetaFor that
   includes:
   - story ownership and descriptor location;
   - repository versus package Storybook boundary;
   - router model and canonical URL rules;
   - overview and detail hierarchy;
   - Workbench regions and responsive behavior;
   - source, copy, controls, events, and reference presentation;
   - lazy loading and browser-bundle isolation;
   - retained ownership, Flex composition, clipping, and input;
   - server, HMR policy, process ownership, port, and browser target;
   - static build, Pages base, deep-link recovery, and manifest;
   - readiness, console, DOM/SVG/WebGPU, and non-black-canvas evidence;
   - font and asset ownership;
   - exact dependency pins and single-module identity.
5. Derive one proposed law with stable requirement IDs. Explain why each law is
   owned by `@zavx0z/storybook` or remains owner-specific.
6. Present the smallest staged migration plan and wait for explicit owner
   approval before implementation.

## Target architectural constraints

- Usually one Storybook application/lifecycle per repository. A package gets a
  separate Storybook only when its lifecycle, delivery, or isolation boundary
  genuinely requires one.
- Package-owned story descriptors stay next to their semantic owner and are
  composed by the repository Storybook without copying production semantics.
- `@zavx0z/storybook` may use the production UI stack for the shared
  Blender-like Workbench, but production packages must never import it.
- Model UI/Engine/Layout dependencies so a cold checkout has a deterministic
  bootstrap and exactly one runtime identity. Consider peer dependencies and
  private Storybook-app dependencies; do not dismiss a dev/bootstrap cycle
  without proving the install and typecheck order.
- Import exact lowercase owner subpaths. No root barrel, aliases, `paths`,
  wrappers, generated copies, or compatibility re-exports.
- Visible Workbench strings are Russian. Public identifiers and TypeScript
  import specifiers preserve their exact spelling.
- Use pathname routing unless an owner-approved exception is demonstrated.
  Overview and prefix routes end in `/`; exact leaves do not. Unknown suffixes
  fail closed instead of choosing a fallback story.
- Preserve one no-HMR process and one exact browser target per repository
  Storybook unless the comparison proves a different lifecycle is required.
- A shared Workbench follows the accepted parent-owned Flex, retained-parent,
  shaped-clipping, Blender-like density, and read-only CodeEditor contracts.
- Existing Engine, Layout, UI, Node, and MetaFor story semantics remain owned by
  those repositories. Shared infrastructure must not introduce Node, product,
  Field, Socket, or domain switches.

## Current contours that must be investigated, not blindly preserved

- Engine Storybook: port 4173, `/engine/`, current hash stories.
- Layout Storybook: port 4020, current runtime fixture and Pages build.
- UI Storybook: port 4017, mounts for Elements, Components, diagnostic
  Storybook, and HUD; this process must remain running after any approved
  cutover.
- Node Storybook: port 4018, repository pages for Core, Editor, Layout, Worker,
  and UI. Treat this as a candidate, not ground truth.
- MetaFor currently contains active, potentially uncommitted Quantum Storybook
  work around port 4019. Preserve it and coordinate before touching overlapping
  files.

Check whether Highlighter or Interpreter needs to be attached later. Do not add
them merely because they are dependencies; add a folder only if the migration
requires reading or changing its Storybook boundary.

## Expected migration shape after approval

The plan should evaluate, not assume, this sequence:

1. Establish the direct public contracts and tests in `@zavx0z/storybook`.
2. Extract generic infrastructure from the current mixed `@ui/storybook`, while
   leaving UI-owned catalog, stories, preview, references, routes, lifecycle,
   and Pages in the UI repository.
3. Migrate UI first with exact route, pixel, source, event, bundle, lifecycle,
   and static-output parity.
4. Migrate Node after UI and compare every Node-specific extension against the
   common contract.
5. Migrate Engine and Layout in separate owner slices without making their
   production packages depend on UI or Storybook.
6. Migrate MetaFor only after its current Storybook work has a stable owner
   checkpoint.
7. Remove duplicated generic infrastructure only after all direct consumers
   have moved. Do not leave compatibility aliases or re-export packages.

## Required acceptance

- Focused and full checks for every changed owner repository.
- Cold install/bootstrap proof from exact dependency revisions.
- One realpath/module identity for Engine, Layout, UI, and shared dependencies.
- Existing route parity unless a route migration was separately accepted.
- Fail-closed unknown routes and deep-link recovery.
- Static manifest and independently split lazy browser graphs.
- Exact existing target checks with console 0 and non-black WebGPU canvases.
- DOM and SVG readiness where applicable.
- No listener adoption, no focus changes, and no kill-by-port behavior.
- No push, PR, deployment, Pages dispatch, or remote repository creation
  without a new explicit owner instruction.

## First response in the new task

Return only the evidence-backed audit, proposed unified laws, migration stages,
risks, and blocking owner decisions. Do not implement anything until the owner
approves that plan in the new task.
