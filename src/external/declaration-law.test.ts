import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {
  EXTERNAL_STORYBOOK_EXPORT_PATTERN,
  EXTERNAL_STORYBOOK_MODULE_PATH_PATTERN,
  EXTERNAL_STORYBOOK_PACKAGE_ID_PATTERN,
  EXTERNAL_STORYBOOK_ROUTE_PATTERN,
  EXTERNAL_STORYBOOK_SCOPE_ID_PATTERN,
  validateExternalStorybookExportName,
  validateExternalStorybookModulePath,
  validateExternalStorybookPackageId,
  validateExternalStorybookRoute,
  validateExternalStorybookScopeId,
} from "./declaration-law.ts"

describe("external Storybook declaration validation law", () => {
  test("keeps runtime validators and published JSON Schema patterns identical", async () => {
    const manifest = await Bun.file(join(import.meta.dir, "..", "..", "schemas", "manifest.schema.json")).json()
    const catalog = await Bun.file(join(import.meta.dir, "..", "..", "schemas", "catalog.schema.json")).json()
    expect(manifest.$defs.scopeId.pattern).toBe(EXTERNAL_STORYBOOK_SCOPE_ID_PATTERN)
    expect(manifest.$defs.packageId.pattern).toBe(EXTERNAL_STORYBOOK_PACKAGE_ID_PATTERN)
    expect(manifest.$defs.exportName.pattern).toBe(EXTERNAL_STORYBOOK_EXPORT_PATTERN)
    expect(manifest.$defs.modulePath.pattern).toBe(EXTERNAL_STORYBOOK_MODULE_PATH_PATTERN)
    expect(catalog.$defs.id.pattern).toBe(EXTERNAL_STORYBOOK_SCOPE_ID_PATTERN)
    expect(catalog.$defs.route.pattern).toBe(EXTERNAL_STORYBOOK_ROUTE_PATTERN)
    expect(catalog.$defs.exportName.pattern).toBe(EXTERNAL_STORYBOOK_EXPORT_PATTERN)
    expect(catalog.$defs.modulePath.pattern).toBe(EXTERNAL_STORYBOOK_MODULE_PATH_PATTERN)
  })

  test("accepts the shared positive corpus", () => {
    for (const id of ["webxr", "node-editor", "renderer.dom"]) {
      expect(validateExternalStorybookScopeId(id, "id")).toBe(id)
    }
    for (const id of ["bulk", "@ui/components", "@zavx0z/dom"]) {
      expect(validateExternalStorybookPackageId(id, "package")).toBe(id)
    }
    for (const route of ["a", "components/button/basic/contained", "dom/interfaces/document/tree/default"]) {
      expect(validateExternalStorybookRoute(route, "route")).toBe(route)
    }
    for (const name of ["default", "runtime", "story_2", "$story"]) {
      expect(validateExternalStorybookExportName(name, "export")).toBe(name)
    }
    for (const path of ["./runtime.ts", "./stories/button.tsx", "../src/story.mts"]) {
      expect(validateExternalStorybookModulePath(path, "module")).toBe(path)
    }
  })

  test("rejects values that cannot survive loader, URL and generated-import boundaries", () => {
    for (const route of ["Button/default", "button/a b", "button/%2F", "button//default", "button/default/", "__proto__"]) {
      expect(() => validateExternalStorybookRoute(route, "route"), route).toThrow()
    }
    for (const name of ["story-name", "story name", "story\nname", "story} from './other.ts'"]) {
      expect(() => validateExternalStorybookExportName(name, "export"), name).toThrow()
    }
    for (const path of ["/absolute.ts", "C:/story.ts", ".\\story.ts", "./story.ts?raw", "./story.ts#part", "./story\n.ts"]) {
      expect(() => validateExternalStorybookModulePath(path, "module"), path).toThrow()
    }
    expect(validateExternalStorybookRoute("", "route", {allowEmpty: true})).toBe("")
    expect(() => validateExternalStorybookRoute("", "route")).toThrow()
  })
})
