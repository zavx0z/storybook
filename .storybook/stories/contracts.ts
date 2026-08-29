import type {Document, HTMLElement} from "@zavx0z/dom"

type Contract = Readonly<{
  title: string
  summary: string
  ownership: string
  example: string
}>

const contracts = Object.freeze({
  routeTree: contract(
    "Canonical graph and routes",
    "Versioned standalone package, project and optional workspace declarations resolve atomically into one immutable graph. Package, category and subject overviews remain real states; unknown routes fail closed.",
    "Owners provide ordered JSON. External Storybook derives landing, navigation, search, URLs, build lookup and the current MCP viewport from the same identities; a failed attach leaves the current registry unchanged.",
    "storybook check ./packages/components",
  ),
  stories: contract(
    "Owner story modules",
    "A catalog stores one static module path and export name for each executable variant. Story modules import production owners, never Storybook.",
    "The external PackageSession validates exports and emits literal lazy imports before browser delivery.",
    "export const contained = createContainedButtonStory()",
  ),
  catalog: contract(
    "JSON catalog",
    "The only first-stage catalog model is category → subject → variant with optional presentation groups and explicit migration routes. README is read from the owner file through a bounded Markdown renderer.",
    "The package owns semantic order and resources. Collapse state and Workbench layout stay external; embedded HTML and JavaScript are never executed.",
    ".storybook/catalog.json",
  ),
  workbench: contract(
    "Six-region Workbench",
    "Catalog, secondary navigation, preview, scenarios, inspector and status are one stable DOM-native shell projected as a camera-locked overlay.",
    "The external page Experience owns one semantic Document and one Canvas/Renderer/Space host. The restored Navigation Tree owns disclosure, search, keyboard/pointer focus and bounded row projection.",
    "Document → DocumentSpaceRuntime → Workbench overlay",
  ),
  references: contract(
    "Owner evidence resources",
    "Reference metadata and media remain linked owner resources for a later acceptance stage.",
    "MCP may create bounded evidence captures, but this stage does not create accepted baselines, visual diffs or owner acceptance state.",
    "resources.references: [\"./reference.png\"]",
  ),
  app: contract(
    "One package tab realm",
    "One package tab loads one generated entry, one runtime adapter and only its selected lazy story chunks into one page Experience. Compiler metafiles fix canonical dependency realpaths.",
    "The shared shell owns one semantic Document and host Canvas/Renderer/Space. A structural adapter may atomically mount one bounded direct Engine Space; it receives no raw Renderer and creates no second canvas. Named tabs remain separate Experiences.",
    "one package = one tab = one DocumentSpaceRuntime; base → bounded → semantic overlays",
  ),
  server: contract(
    "One server and origin",
    "One daemon owns automatic-port HTTP/WebSocket state for every attached root and package tab; MCP connection lifetime is independent.",
    "The shared controller migrates verified legacy TMPDIR state, rejects foreign checkouts and fences daemon publication with one atomic startup lease; no consumer owns a listener or port.",
    "storybook serve ./workspace\nstorybook_ensure({roots})",
  ),
  launcher: contract(
    "MCP and human adapters",
    "Ensure, attach, search, open, wait, inspect, interact, capture, check, close and explicit administration call one typed controller.",
    "Opaque views persistently reuse a bridge-attested storybook:<package-id> target across MCP processes and server origins; confirmed duplicates are reconciled only after ready.",
    [
      "storybook attach ./project",
      "storybook detach project-id",
      "storybook open @ui/components components/button/basic/contained",
      "storybook status",
      "storybook check @ui/components",
      "storybook stop",
      "background direct CDP; no Chrome activation, ai-macos, @meta/chrome or browser CLI",
    ].join("\n"),
  ),
  scaffold: contract(
    "Declaration initialization",
    "storybook init creates .storybook data and optional runtime/story owner directories, not a private npm package.",
    "No package.json, bunfig, server, build wrapper, port or dependency is introduced.",
    "storybook init packages/components --kind package --executable --stories",
  ),
  build: contract(
    "Independent PackageSession",
    "Each package has a serial queue, isolated candidate, immutable built revision, exact graph snapshot, activation lease and lastWorking diagnostics.",
    "Only browser-acknowledged create → mount → presented frame promotes active/lastWorking. A failed candidate never cancels successful peers.",
    "candidate → built → activating → active/lastWorking",
  ),
  environment: contract(
    "Package-scoped updates",
    "Metafile identities and typed declaration/code/metadata/resource watchers invalidate only their owning sessions; local README assets are allowlisted and watched explicitly.",
    "Package-scoped events reload only matching views; package.failed preserves route and lastWorking presentation.",
    "package.code-updated | package.resources-updated | package.metadata-updated | package.updated",
  ),
})

export const routeTree = contracts.routeTree
export const stories = contracts.stories
export const catalog = contracts.catalog
export const workbench = contracts.workbench
export const references = contracts.references
export const app = contracts.app
export const server = contracts.server
export const launcher = contracts.launcher
export const scaffold = contracts.scaffold
export const build = contracts.build
export const environment = contracts.environment

function contract(
  title: string,
  summary: string,
  ownership: string,
  example: string,
) {
  return Object.freeze({
    render(document: Document): HTMLElement {
      const root = document.createElement("article")
      root.className = "external-contract"
      const heading = document.createElement("h2")
      const summaryNode = document.createElement("p")
      const ownershipNode = document.createElement("p")
      const code = document.createElement("pre")
      heading.textContent = title
      summaryNode.textContent = summary
      ownershipNode.textContent = ownership
      code.textContent = example
      root.append(heading, summaryNode, ownershipNode, code)
      return root
    },
    source: Object.freeze({
      html: `<article><h2>${title}</h2><p>${summary}</p></article>`,
      css: ".external-contract { display: flex; flex-direction: column; }",
      typescript: example,
    }),
    props: Object.freeze({title}),
  })
}
