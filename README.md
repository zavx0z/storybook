# @zavx0z/storybook

Shared private development framework for repository- and package-owned
Storybooks.

This repository does not own Engine, Layout, UI, Node, or MetaFor stories. Each
real repository or package owner keeps its catalog, scenarios, preview state,
lifecycle, static delivery, and acceptance. This package provides the common
Workbench, route, server, build, and evidence contracts through exact public
subpaths and has no root export.

The accepted laws are in [requirements.md](requirements.md). The initial
migration brief remains in [MIGRATION_PROMPT.md](MIGRATION_PROMPT.md).

## Self documentation

This repository dogfoods the package through its own Russian documentation
Storybook:

```bash
bun run storybook
```

Open `http://127.0.0.1:4016`. The root is the real five-region WebGPU
Workbench: every public subpath is a normal story in its catalog, with the
explanation in preview and the exact import example in the source panel.
Public changes must update that story and example in the same change.

```bash
bun run check
```

The check typechecks sources and examples, tests exact documentation coverage,
and builds the self-contained `/storybook/` static artifact.
