import {expect, test} from "bun:test"
import {readFileSync} from "node:fs"
import {join} from "node:path"

const root = join(import.meta.dir, "../src")

test("модель использует production Panel и compiled widgets без ручного видимого DOM", () => {
  const controller = readFileSync(join(root, "model.ts"), "utf8")
  const widgetPanel = readFileSync(join(root, "inspector/widget-panel.tsx"), "utf8")
  const inspectorRegistry = readFileSync(join(root, "inspector/registry.ts"), "utf8")
  const sourceWidget = readFileSync(join(root, "inspector/source-widget.tsx"), "utf8")
    expect(widgetPanel).toContain('from "@zavx0z/ui/surface/panel"')
    expect(widgetPanel).toContain("<Panel")
    expect(widgetPanel).toContain("props.onToggle(props.widget.id, expanded)")
    expect(widgetPanel).not.toContain("InspectorSection")
    expect(widgetPanel).not.toContain("id={props.widget.id}")
    expect(controller).not.toContain("createElement(")
    expect(controller).not.toContain("StorybookDom")
    expect(widgetPanel).toContain('from "@zavx0z/ui/surface/panel"')
    expect(widgetPanel).not.toContain("InspectorSection")
    expect(inspectorRegistry).not.toContain("uiIcons")
    expect(sourceWidget).toContain('from "@zavx0z/ui/view/code-editor"')
})
