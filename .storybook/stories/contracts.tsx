import type {HTMLElement} from "@zavx0z/dom"
import {createRoot} from "@zavx0z/react"
import {
  ContractDocument,
  type ContractDocumentProps,
} from "./contract-document.tsx"
import {
  defineSelfStory,
  serializeSelfElement,
} from "./story-types.ts"

type Contract = ContractDocumentProps

const contracts = Object.freeze({
  routeTree: contract(
    "Canonical graph and routes",
    "Versioned standalone package, project and optional workspace declarations resolve atomically into one immutable graph. Package, category and subject overviews remain real states; unknown routes fail closed. Category and subject overviews render real immediate child stories without selecting their representative routes.",
    "Owners provide ordered JSON. External Storybook derives landing, navigation, search, URLs, build lookup and the current MCP viewport from the same identities; a failed attach leaves the current registry unchanged. One compiled aggregate contains separate runtime/3 child sessions in the same Document and owns a CSS row with flex-wrap, align-content: flex-start and gap: 8px; Renderer packs bounded tiles into compact cross-start rows, one child fills preview, and vertical overflow is only a small-height fallback. Storybook never computes packing coordinates.",
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
    "The only first-stage catalog model is category → subject → variant with optional presentation groups and explicit migration routes. A category may own paired kind/apiName so a primary component expresses its sections as ordinary subjects. README is read from the owner file through a bounded Markdown renderer.",
    "The package owns semantic order, typed category identity and resources. Collapse state and Workbench layout stay external; promoted route lists and embedded HTML/JavaScript are forbidden.",
    ".storybook/catalog.json",
  ),
  workbench: contract(
    "Six-region Workbench",
    "Catalog, secondary navigation, preview, scenarios, inspector and status are six compiled TSX region components composed by one stable Workbench root and projected as a camera-locked overlay. Expanded primary disclosure groups occupy their header and every visible category row before the next root row.",
    "The external page Experience owns one semantic Document and one Canvas/Renderer/Space host. The host loads the exact @engine/core Inter Regular default font through its stable asset route. Workbench modules separately own controller/state, presentation reparent, navigation model/windowing/rows/tree and the one production Inspector. The status region adapts WorkbenchStatus lead/owner/detail into the exact production StatusBar owner. Primary category, secondary subject and scenario dock remain distinct projections. Shared human-facing Inspector chrome and built-in widget titles are Russian; owner values and standard technical identifiers remain exact. Every TSX owner keeps its CSS inside the component.",
    "Document → DocumentSpaceRuntime → Workbench overlay",
  ),
  authorStyles: contract(
    "Linked author styles and root source",
    "A package declares ordered exact public CSS export specifiers owned by itself or a manifest-reached local dependency. Each immutable revision materializes one native link per resource before its module entry; required links must be ready before the one DocumentSpaceRuntime is created.",
    "Global Source CSS comes from the declared author registry. Component Source CSS comes only from one active ComponentRoot authored provenance and is rendered as raw highlighted CSS. Dynamic declarations remain inline in HTML. Cleanup always disposes runtime before the linked host; Workbench chrome and generated selectors cannot enter Source.",
    "authorStyleSheets: [{\"specifier\":\"@ui/components/theme.css\"}]\nruntime.dispose() → themeHost.dispose()",
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
    "The shared shell owns one semantic Document and one host Canvas/Renderer/Space/ViewPoint. Only a declared world subject receives the exact shared context.space and may register its semantic node and camera through mountWorldPreview; no child Space, ViewPoint, Renderer or Canvas exists. Named tabs remain separate Experiences. Native page title is MetaFor for self and the exact package label for owners, never Storybook branding.",
    "one package = one tab = one DocumentSpaceRuntime → shared world + semantic projection roots",
  ),
  server: contract(
    "One server and origin",
    "One daemon owns automatic-port HTTP/WebSocket state for every attached root and package tab; MCP connection lifetime is independent.",
    "The shared controller migrates verified legacy TMPDIR state, rejects foreign checkouts and fences daemon publication with one atomic startup lease; no consumer owns a listener or port.",
    "storybook serve ./workspace\nstorybook_ensure({roots})",
  ),
  launcher: contract(
    "MCP and human adapters",
    "Ensure, attach, search, open, wait, inspect, interact, capture, check, close and explicit administration call one typed controller. Inspection exposes the shell-owned Canvas as singular canvas state. Key interaction activates and verifies the exact Workbench owner in the existing native-input host before browser keydown and keyup.",
    "Opaque views persistently reuse a bridge-attested storybook:<package-id> target across MCP processes and server origins; confirmed duplicates are reconciled only after ready. Canvas capture targets the same exact shell Canvas without native plural discovery. The bridge never fabricates semantic keyboard events or creates a second input owner, so Browser-owned Escape, Range and Select defaults remain authoritative.",
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
export const authorStyles = contracts.authorStyles
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
  const props = Object.freeze({title, summary, ownership, example})
  return defineSelfStory((document) => {
    const staging = document.createElement("div")
    const root = createRoot(staging)
    root.render(<ContractDocument
      title={props.title}
      summary={props.summary}
      ownership={props.ownership}
      example={props.example}
    />)
    const element = staging.firstElementChild as HTMLElement | null
    if (element === null) {
      root.unmount()
      throw new Error("Self Storybook Contract mounted no document")
    }
    staging.removeChild(element)
    return Object.freeze({
      element,
      root,
      source: Object.freeze({
        html: serializeSelfElement(element),
        typescript: example,
      }),
      props: Object.freeze({title}),
      dispose: () => root.unmount(),
    })
  })
}
