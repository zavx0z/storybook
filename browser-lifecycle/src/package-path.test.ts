import {expect, test} from "bun:test"
import {storybookPackagePathSegment, storybookPackageUrlPath, storybookPackageRouteFromPathname, storybookCurrentRouteKey} from "./contract.ts"

test("uses typed readable package and direct-directory segments without changing identities", () => {
  expect(storybookPackagePathSegment("@zavx0z/dom")).toBe("zavx0z-dom")
  expect(storybookPackageUrlPath("@zavx0z/dom")).toBe("/pkg-zavx0z-dom/")
  expect(storybookPackageUrlPath("bulk")).toBe("/pkg-bulk/")
  const path = "/pkg-zavx0z-storybook/dir-workbench"
  expect(storybookPackageUrlPath("@zavx0z/storybook", "dir-workbench")).toBe(path)
  expect(storybookPackageRouteFromPathname(path, "@zavx0z/storybook")).toBe("dir-workbench")
  expect(storybookPackageUrlPath("@zavx0z/storybook", "workbench/contract")).toBe("/pkg-zavx0z-storybook/workbench/contract")
  expect(storybookPackageRouteFromPathname(path, "@zavx0z/dom")).toBeNull()
  expect(storybookPackageRouteFromPathname(`${path}/dir-navigation`, "@zavx0z/storybook")).toBe("dir-workbench/dir-navigation")
  expect(storybookPackageUrlPath("@zavx0z/storybook", "dir-workbench/dir-navigation")).toBe(`${path}/dir-navigation`)
  expect(storybookPackageRouteFromPathname(`${path}/wrong-segment`, "@zavx0z/storybook")).toBeNull()
  const escaped = "dir-with%20%23%20hash"
  expect(storybookPackageRouteFromPathname(storybookPackageUrlPath("@zavx0z/storybook", escaped), "@zavx0z/storybook")).toBe(escaped)
})

test("recognizes old published page paths while translating their directory keys at the adapter boundary", () => {
  const route = storybookPackageRouteFromPathname("/packages/%40zavx0z%2Fstorybook/~directories/workbench/", "@zavx0z/storybook")
  expect(route).toBe("~directories/workbench")
  expect(storybookCurrentRouteKey(route!)).toBe("dir-workbench")
  expect(storybookPackageRouteFromPathname("/packages/zavx0z-storybook/workbench/contract/", "@zavx0z/storybook")).toBe("workbench/contract")
})
