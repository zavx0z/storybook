import {describe, expect, test} from "bun:test"
import Identity from "@zavx0z/storybook-package-identity"
const {pattern: EXTERNAL_STORYBOOK_PACKAGE_ID_PATTERN, package: validateExternalStorybookPackageId} = Identity

describe("package.json identity law", () => {
  test("accepts exact scoped and unscoped package names", () => {
    const pattern = new RegExp(EXTERNAL_STORYBOOK_PACKAGE_ID_PATTERN, "u")
    for (const name of ["bulk", "@fixture/components", "@zavx0z/immersive-dom"]) {
      expect(validateExternalStorybookPackageId(name, "package.json name")).toBe(name)
      expect(pattern.test(name)).toBeTrue()
    }
  })

  test("rejects names that cannot form stable package routes", () => {
    for (const name of ["", "@scope/", "Name", "a/b/c", "a b", "__proto__\n"]) {
      expect(() => validateExternalStorybookPackageId(name, "package.json name"), name).toThrow()
    }
  })
})
