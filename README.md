# @zavx0z/storybook

Shared private development framework for repository- and package-owned
Storybooks.

This repository does not own Engine, Layout, UI, Node, or MetaFor stories. Each
real repository or package owner keeps its catalog, scenarios, preview state,
lifecycle, static delivery, and acceptance. This package provides the common
Workbench, route, server, build, and evidence contracts through exact public
subpaths and has no root export.

The accepted laws are in [requirements.md](requirements.md).

## Self documentation

This repository dogfoods the package through its own Russian documentation
Storybook:

Use `$storybook ensure @zavx0z/storybook` and open the reported automatic
origin.
The root is the real five-region WebGPU Workbench: every public subpath is a
normal story in its catalog, with the explanation in preview and the exact
import example in the source panel. Public changes must update that story and
example in the same change.

```bash
bun run check
```

The check typechecks sources and examples, tests exact documentation coverage,
and builds the self-contained `/storybook/` static artifact.

## One Storybook skill

Runnable Storybooks are addressed only by their exact package name. The shared
launcher resolves the package, asks the operating system for a free port and
tracks the exact process without a consumer port registry:

```bash
bun scripts/storybook.ts status @ui/storybook --root ../webxr-space/projects/ui
bun scripts/storybook.ts ensure @ui/storybook --root ../webxr-space/projects/ui
```

The same package identity drives background browser evidence; routes and canvas
capabilities come from the running app rather than a copied registry:

```bash
.agents/skills/storybook/scripts/storybook.sh browser targets @ui/storybook
.agents/skills/storybook/scripts/storybook.sh browser reload @ui/storybook \
  --route /components/button/basic/contained --target-id TARGET_ID
```

Create a new canonical package from the one maintained template:

```bash
bun scripts/create-storybook.ts @quantum/storybook ../metafor/quantum/storybook
```

The generator refuses an existing target. Adoption of an existing Storybook is
a migration, never a scaffold overwrite.

The manual Pages workflow registers exact Engine, Layout, UI, Highlighter, and
self package owners, completes their frozen bootstrap, and publishes only this
repository's documentation.
