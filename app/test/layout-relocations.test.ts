import {afterEach, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import type {Zavx0zStorybookChatSession} from "@zavx0z/storybook-chat-session"
import type {Zavx0zStorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"
import {relocateAppChats, relocatedAppAddress} from "../src/layout-relocations"

type Graph = Zavx0zStorybookPackageGraphRead.Input
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true})
})

async function fixture() {
  const toolRoot = await mkdtemp(join(tmpdir(), "storybook-layout-relocation-"))
  roots.push(toolRoot)
  const current = join(toolRoot, "app/web/page/shell/minimap")
  const base = "/storybook/app/web/page/shell/minimap"
  const owner = {
    id: "package:@zavx0z/storybook-app-web-page-shell-minimap",
    kind: "package",
    packageId: "@zavx0z/storybook-app-web-page-shell-minimap",
    urlPath: base,
    source: {path: join(current, "package.json")},
  }
  const directory = {
    id: "directory:@zavx0z/storybook-app-web-page-shell-minimap/src",
    kind: "directory",
    packageId: "@zavx0z/storybook-app-web-page-shell-minimap",
    urlPath: `${base}/src`,
    source: {path: join(current, "src")},
  }
  const nested = {
    id: "package:@fixture/nested",
    kind: "package",
    packageId: "@fixture/nested",
    urlPath: `${base}/nested`,
    source: {path: join(current, "nested/package.json")},
  }
  const graph = (nodes: unknown[] = [owner, directory, nested]) => ({nodes} as unknown as Graph)
  return {toolRoot, current, base, owner, directory, nested, graph}
}

test("стабильный packageId переносит только собственный пакет и его директории", async () => {
  const f = await fixture()
  const calls: Parameters<Zavx0zStorybookChatSession.Output["relocate"]>[0][] = []
  const chats = {async relocate(input: Parameters<Zavx0zStorybookChatSession.Output["relocate"]>[0]) { calls.push(input); return null }} as Zavx0zStorybookChatSession.Output
  await relocateAppChats(f.toolRoot, f.graph(), chats)
  expect(calls).toEqual([
    {
      from: {address: "/storybook/app/web/minimap", cwd: join(f.toolRoot, "app/web/minimap")},
      to: {address: f.base, cwd: f.current},
    },
    {
      from: {address: "/storybook/app/web/minimap/src", cwd: join(f.toolRoot, "app/web/minimap/src")},
      to: {address: `${f.base}/src`, cwd: join(f.current, "src")},
    },
  ])
  expect(relocatedAppAddress(f.toolRoot, f.graph(), "/storybook/app/web/minimap")).toBe(f.base)
  expect(relocatedAppAddress(f.toolRoot, f.graph(), "/storybook/app/web/minimap/src")).toBe(`${f.base}/src`)
  expect(relocatedAppAddress(f.toolRoot, f.graph(), "/storybook/app/web/minimap/nested")).toBeNull()
})

test("иной toolRoot, packageId или Repo не получает старые адреса", async () => {
  const f = await fixture()
  const wrongRoot = join(f.toolRoot, "other")
  const wrongId = {...f.owner, packageId: "@fixture/other"}
  const foreign = {...f.owner, source: {path: join(wrongRoot, "app/web/page/shell/minimap/package.json")}}
  const calls: unknown[] = []
  const chats = {async relocate(input: unknown) { calls.push(input); return null }} as Zavx0zStorybookChatSession.Output
  await relocateAppChats(wrongRoot, f.graph(), chats)
  await relocateAppChats(f.toolRoot, f.graph([wrongId]), chats)
  await relocateAppChats(f.toolRoot, f.graph([foreign]), chats)
  expect(calls).toEqual([])
  expect(relocatedAppAddress(wrongRoot, f.graph(), "/storybook/app/web/minimap")).toBeNull()
  expect(relocatedAppAddress(f.toolRoot, f.graph([wrongId]), "/storybook/app/web/minimap")).toBeNull()
  expect(relocatedAppAddress(f.toolRoot, f.graph(), "/consumer/app/web/minimap")).toBeNull()
})

test("redirect получает только pathname; сервер сохраняет исходную query у новой цели", async () => {
  const f = await fixture()
  const url = new URL("http://storybook.test/storybook/app/web/minimap?view=contract&inspector=chat")
  const target = relocatedAppAddress(f.toolRoot, f.graph(), url.pathname)
  expect(target).toBe(f.base)
  expect(`${target}${url.search}`).toBe(`${f.base}?view=contract&inspector=chat`)
  expect(relocatedAppAddress(f.toolRoot, f.graph(), "/storybook/app/web/minimap?view=contract")).toBeNull()
})

test("конфликт Zavx0zStorybookChatSession.relocate останавливает переход без подавления ошибки", async () => {
  const f = await fixture()
  let calls = 0
  const chats = {async relocate() { calls += 1; throw new Error("Новый адрес уже занят другой беседой") }} as unknown as Zavx0zStorybookChatSession.Output
  await expect(relocateAppChats(f.toolRoot, f.graph(), chats)).rejects.toThrow("занят другой беседой")
  expect(calls).toBe(1)
})
