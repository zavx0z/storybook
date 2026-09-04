import {describe, expect, test} from "bun:test"
import {existsSync, readdirSync, readFileSync} from "node:fs"
import {basename, join} from "node:path"

const root = import.meta.dir

describe("Workbench component module boundary", () => {
  test("owns a modular TSX tree without the retired generic DOM directory", () => {
    expect(existsSync(join(root, "../dom"))).toBeFalse()
    const files = sourceFiles(root)
    const production = files.filter(path => !/\.(?:test|fixture)\.[cm]?[jt]sx?$/u.test(path))
    for (const path of production) {
      const lines = readFileSync(path, "utf8").split("\n").length
      expect(lines, `${path} grew back into a monolith`).toBeLessThanOrEqual(400)
    }
  })

  test("keeps CSS in owning TSX components and visible construction compiled", () => {
    for (const path of sourceFiles(root).filter(path => path.endsWith(".tsx"))) {
      const source = readFileSync(path, "utf8")
      expect(source, path).not.toMatch(/^(?:export\s+)?const\s+\w+[^=\n]*=\s*css`/mu)
      expect(source, path).not.toContain("CssStyle")
      expect(source, path).not.toMatch(/&\s*\{/u)
      expect(source, path).not.toContain("createElement(")
      expect(source, path).not.toContain("defineStyles")
      expect(source, path).not.toContain("style={[")
      expect(source, path).not.toContain("style={{")
    }
  })

  test("composes six region owners and one production Inspector", () => {
    const files = sourceFiles(root).filter(path => path.endsWith(".tsx"))
    const sources = files.map(path => ({path, source: readFileSync(path, "utf8")}))
    const regions = sources.flatMap(({source}) =>
      [...source.matchAll(/data-storybook-region="([^"]+)"/gu)].map(match => match[1]))
    expect(regions.sort()).toEqual([
      "catalog",
      "inspector",
      "preview",
      "scenarios",
      "secondary",
      "status",
    ])
    const inspectorOwners = sources.flatMap(({path, source}) =>
      /<Inspector(?:\s|>)/u.test(source) ? [path] : [])
    expect(inspectorOwners).toEqual([join(root, "inspector/panel.tsx")])

    const view = readFileSync(join(root, "view.tsx"), "utf8")
    for (const component of [
      "CatalogRegion",
      "SecondaryRegion",
      "PreviewRegion",
      "ScenariosRegion",
      "InspectorRegion",
      "StatusRegion",
    ]) expect(view).toContain(`<${component}`)
  })

  test("composes the production Pane instead of duplicating its visual contract", () => {
    const panel = readFileSync(join(root, "components/region-panel.tsx"), "utf8")
    const preview = readFileSync(join(root, "regions/preview.tsx"), "utf8")
    expect(panel).toContain('from "@zavx0z/ui/surfaces/pane"')
    expect(panel).toContain("<Pane")
    for (const declaration of [
      "box-sizing:",
      "overflow:",
      "border:",
      "border-radius:",
      "padding:",
      "background:",
      "color:",
    ]) expect(panel).not.toContain(declaration)
    expect(preview).toContain('transparent={props.projection !== "hud"}')
  })

  test("composes the production StatusBar instead of duplicating its footer visual contract", () => {
    const status = readFileSync(join(root, "regions/status.tsx"), "utf8")
    expect(status).toContain('from "@zavx0z/ui/feedback/status-bar"')
    expect(status).toContain('from "@zavx0z/ui/navigation/breadcrumbs"')
    expect(status).toContain("<StatusBar")
    expect(status).toContain("<Breadcrumbs")
    expect(status).not.toContain("<footer")
    expect(status).not.toContain("<Typography")
    for (const declaration of [
      "height:",
      "padding:",
      "border:",
      "background:",
      "color:",
      "font-size:",
      "line-height:",
    ]) expect(status).not.toContain(declaration)
  })

  test("keeps reusable component contour and states with production owners", () => {
    const inspector = readFileSync(join(root, "inspector/panel.tsx"), "utf8")
    const widgetPanel = readFileSync(join(root, "inspector/widget-panel.tsx"), "utf8")
    expect(inspector).not.toContain("style=")
    expect(inspector).toContain("panelIds:")
    expect(inspector).not.toContain("InspectorSections")
    expect(inspector).not.toContain("sectionIds")
    expect(inspector).not.toContain("context=")
    expect(widgetPanel).toContain('from "@zavx0z/ui/surfaces/panel"')
    expect(widgetPanel).toContain("<Panel")
    expect(widgetPanel).toContain("props.onToggle(props.widget.id, expanded)")
    expect(widgetPanel).not.toContain("InspectorSection")
    expect(widgetPanel).not.toContain("id={props.widget.id}")
    expect(existsSync(join(root, "inspector/widget-section.tsx"))).toBeFalse()

    expect(existsSync(join(root, "components/region-heading.tsx"))).toBeFalse()
    for (const path of [
      join(root, "regions/catalog.tsx"),
      join(root, "regions/secondary.tsx"),
      join(root, "regions/scenarios.tsx"),
      join(root, "regions/preview.tsx"),
    ]) {
      const source = readFileSync(path, "utf8")
      expect(source, path).not.toContain("WorkbenchRegionHeading")
      expect(source, path).not.toContain("<header")
    }

    const catalog = readFileSync(join(root, "regions/catalog.tsx"), "utf8")
    for (const opening of componentOpenings(catalog, "TextField")) {
      expect(opening).not.toContain("height:")
      expect(opening).not.toContain("padding:")
    }

    for (const path of [
      join(root, "components/navigation-list.tsx"),
      join(root, "navigation/row.tsx"),
      join(root, "regions/scenarios.tsx"),
    ]) {
      const source = readFileSync(path, "utf8")
      for (const opening of componentOpenings(source, "Button")) {
        for (const declaration of [
          "height:",
          "padding:",
          "font-size:",
          "border:",
          "border-radius:",
          "background:",
          "box-shadow:",
          "opacity:",
        ]) expect(opening, path).not.toContain(declaration)
      }
    }

    const rows = readFileSync(join(root, "navigation/row.tsx"), "utf8")
    expect(rows).toContain("navigationRootBlockRows(block, props.collapsed)")
    expect(rows).not.toContain('&[aria-current="page"]')
    expect(rows).not.toContain('&[data-focused="true"]')
    expect(rows).not.toContain('&[aria-disabled="true"]')
    const secondary = readFileSync(join(root, "components/navigation-list.tsx"), "utf8")
    expect(secondary).not.toContain('&[aria-disabled="true"]')
  })
})

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, {withFileTypes: true})
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap(entry => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return sourceFiles(path)
      if (!entry.isFile() || !/\.[cm]?[jt]sx?$/u.test(entry.name)) return []
      if (basename(path) === basename(import.meta.path)) return []
      return [path]
    })
}

function componentOpenings(source: string, component: string): readonly string[] {
  return [...source.matchAll(new RegExp(`<${component}\\b[\\s\\S]*?\\/>`, "gu"))]
    .map(match => match[0])
}
