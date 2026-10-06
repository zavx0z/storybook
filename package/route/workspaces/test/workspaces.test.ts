import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import readWorkspacePackages from "@zavx0z/storybook-package-route-workspaces"
import resolveRoute from "@zavx0z/storybook-package-route-resolve"
import readRouteChildren from "@zavx0z/storybook-package-route-children"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})))
})

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-workspaces-")))
  roots.push(root)
  for (const path of ["plain", "packages/z", "packages/a", "packages/group/nested", "packages/excluded", "packages/node_modules/dependency"]) {
    await mkdir(join(root, path), {recursive: true})
    await Bun.write(join(root, path, "package.json"), JSON.stringify({name: path.replaceAll("/", "-")}))
  }
  return root
}

test("expands exact paths, stars and recursive globs in stable order with exclusions and deduplication", async () => {
  const root = await fixture()
  const result = await readWorkspacePackages({root, value: ["plain", "packages/*", "packages/**", "!packages/excluded/**"]})
  expect(result.roots).toEqual(["plain", "packages/a", "packages/z", "packages/group/nested"].map(path => join(root, path)))
  expect(result.inputs).toContain(join(root, "packages/group"))
  expect(result.inputs).toContain(join(root, "packages/group/package.json"))
  expect((await readWorkspacePackages({root, value: []})).roots).toEqual([])
  expect((await readWorkspacePackages({root, value: ["packages/{a,z}"]})).roots).toEqual(["packages/a", "packages/z"].map(path => join(root, path)))
})

test("watches partial nested matches before the final directory exists", async () => {
  const root = await fixture()
  const result = await readWorkspacePackages({root, value: ["packages/*/modules/*"]})
  expect(result.roots).toEqual([])
  expect(result.inputs).toContain(join(root, "packages/a"))
})

test("meta остаётся данными владельца и не становится пакетом или входом наблюдения", async () => {
  const root = await fixture()
  await Bun.write(join(root, "packages/a/meta/data/package.json"), JSON.stringify({name: "generated-data"}))
  const result = await readWorkspacePackages({root, value: ["packages/**"]})
  expect(result.roots.some(path => path.includes("/meta/"))).toBeFalse()
  expect(result.inputs.some(path => path.includes("/meta/") || path.endsWith("/meta"))).toBeFalse()
})

test("rejects escaping patterns and symlink packages", async () => {
  const root = await fixture()
  for (const patterns of [["../*"], ["/tmp/*"], ["{../*,plain}"], ["."]]) {
    await expect(readWorkspacePackages({root, value: patterns})).rejects.toThrow("inside the project")
  }
  await symlink(join(root, "plain"), join(root, "linked"))
  await expect(readWorkspacePackages({root, value: ["linked"]})).rejects.toThrow("symlink")
})

test("glob workspaces resolve canonical nested routes and immediate children", async () => {
  const root = await fixture()
  await Bun.write(join(root, "package.json"), JSON.stringify({
    name: "@fixture/root",
    workspaces: ["packages/**", "!packages/excluded/**"],
  }))
  await mkdir(join(root, "packages/group/nested/features/tool"), {recursive: true})
  await Bun.write(join(root, "packages/group/nested/package.json"), JSON.stringify({
    name: "@fixture/nested",
  }))
  await Bun.write(join(root, "packages/group/nested/features/tool/package.json"), JSON.stringify({name: "@fixture/tool"}))
  const registered = [{name: "root", path: root}]

  expect(await resolveRoute({route: "root/packages/a", roots: registered})).toMatchObject({
    node: "root/packages/a",
    pathname: "/root/packages/a",
    package: {id: "packages-a", path: join(root, "packages/a")},
    relativePath: "",
  })
  expect(await resolveRoute({route: "root/packages/group/nested/features/tool", roots: registered})).toMatchObject({
    pathname: "/root/packages/group/nested/features/tool",
    package: {id: "@fixture/tool", path: join(root, "packages/group/nested/features/tool")},
    relativePath: "",
  })
  expect((await readRouteChildren({route: "root/packages", roots: registered})).map(({node}) => node)).toEqual([
    "root/packages/a",
    "root/packages/group",
    "root/packages/z",
  ])
  expect((await readRouteChildren({route: "root/packages/group/nested/features", roots: registered})).map(({node}) => node)).toEqual([
    "root/packages/group/nested/features/tool",
  ])
  expect(await resolveRoute({route: "root/packages/excluded", roots: registered})).toBeNull()
})

test("route refuses invalid workspace patterns and symlink branches", async () => {
  const root = await fixture()
  const registered = [{name: "root", path: root}]
  await Bun.write(join(root, "package.json"), JSON.stringify({name: "@fixture/root", workspaces: ["../*"]}))
  expect(await resolveRoute({route: "root", roots: registered})).toBeNull()

  await Bun.write(join(root, "package.json"), JSON.stringify({name: "@fixture/root", workspaces: ["linked"]}))
  await symlink(join(root, "plain"), join(root, "linked"))
  expect(await resolveRoute({route: "root/linked", roots: registered})).toBeNull()
})

test.each(["src", "index.tsx"])("дети workspace-ветки с %s совпадают с физическими маршрутами", async marker => {
  const root = await fixture()
  await Bun.write(join(root, "package.json"), JSON.stringify({name: "@fixture/root", workspaces: ["packages/**", "!packages/excluded/**"]}))
  if (marker === "src") await mkdir(join(root, "packages/src"))
  else await Bun.write(join(root, "packages/index.tsx"), "export const value = 1\n")
  const registered = [{name: "root", path: root}]
  expect((await readRouteChildren({route: "root/packages", roots: registered})).map(({node}) => node)).toEqual([
    "root/packages/a",
    "root/packages/group",
    "root/packages/z",
  ])
  expect((await readRouteChildren({route: "root/packages/group", roots: registered})).map(({node}) => node)).toEqual([
    "root/packages/group/nested",
  ])
  await mkdir(join(root, "module/src"), {recursive: true})
  await mkdir(join(root, "module/internal"))
  expect(await readRouteChildren({route: "root/module", roots: registered})).toEqual([])
})

test("публичный workspaces module открывает собственный contract view", async () => {
  const storybook = resolve(import.meta.dir, "../../../..")
  expect(await resolveRoute({
    route: "storybook/package/route/workspaces?view=contract",
    roots: [{name: "storybook", path: storybook}],
  })).toMatchObject({
    package: {id: "@zavx0z/storybook-package-route-workspaces"},
    relativePath: "",
    view: "contract",
    views: ["scenarios", "contract"],
  })
})

test("вложенный пакет получает состав из glob Repo без собственных workspaces", async () => {
  const root = await fixture()
  await Bun.write(join(root, "package.json"), JSON.stringify({name: "@fixture/repo", workspaces: ["packages/**", "!packages/excluded/**"]}))
  await Bun.write(join(root, "packages/group/package.json"), JSON.stringify({name: "@fixture/domain"}))
  const domain = await readWorkspacePackages({root: join(root, "packages/group")})
  expect(domain.roots).toEqual([join(root, "packages/group/nested")])
  expect(domain.inputs).toContain(join(root, "package.json"))
  expect((await readWorkspacePackages({root: join(root, "packages/excluded")})).roots).toEqual([])
})
