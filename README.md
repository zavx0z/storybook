# @zavx0z/storybook

Shared private development framework for repository- and package-owned
Storybooks.

This repository does not own Engine, Layout, UI, Node, or MetaFor stories. Each
real repository or package owner keeps its catalog, scenarios, preview state,
lifecycle, static delivery, and acceptance. This package provides the common
Workbench, route, server, build, and evidence contracts through exact public
subpaths and has no root export.

The accepted laws are in [requirements.md](requirements.md).

## DOM-native foundation

Storybook использует один настоящий `@zavx0z/dom` `Document` для
самого примера и общего Storybook shell:

```ts
import {createDocument} from "@zavx0z/dom"
import {defineStorybookDomStory} from "@zavx0z/storybook/stories"
import {
  createStorybookDomWorkbench,
  storybookDomWorkbenchCss,
} from "@zavx0z/storybook/workbench"

const document = createDocument()
const workbench = createStorybookDomWorkbench({document, parent: document})

const story = defineStorybookDomStory({
  defaultArgs: {label: "Output"},
  render(document, args, current) {
    const button = current ?? document.createElement("button")
    button.textContent = args.label
    button.title = "Открыть Output"
    return button
  },
  source: () => ({
    html: "<button title=\"Открыть Output\">Output</button>",
    css: "button { background: #3f5f84; }",
    typescript: "button.addEventListener(\"click\", openOutput)",
  }),
})

workbench.update("catalog.items", [{
  id: "button",
  label: "Кнопка",
  route: "components/button",
}])
```

`storybookDomWorkbenchCss` передаётся CPU renderer как обычная flat CSS string.
Exports `stories`, `catalog` и `workbench` не знают Engine, Layout, Elements,
numeric surfaces или WebGPU; эти стадии находятся ниже semantic boundary.

## Self documentation

This repository dogfoods the package through its own Russian documentation
Storybook:

Use `$storybook ensure @zavx0z/storybook` and open the reported automatic
origin.
The root is the semantic DOM Workbench rendered by the production
CPU/WebGPU document pipeline: every public subpath is a normal DOM story in its
catalog, with the explanation in preview and exact HTML, CSS and TypeScript
documents in the inspector. Public changes must update that story and all
three documents in the same change.

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

Static output remains a local evidence artifact. Pages delivery is
intentionally absent until every independent DOM/renderer owner has an
immutable remote revision and the owner separately authorizes publication.
