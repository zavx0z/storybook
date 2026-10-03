import {afterEach, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {readPublishedSharedBrowserReceipt, readSharedBrowserEpoch, saveSharedBrowserCandidate, saveSharedBrowserReceipt} from "../src/receipt"
import Environment from "@build/environment"
import type {SharedBrowserAssets} from "../contract/assets"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}) })
const digest = (text: string) => createHash("sha256").update(text).digest("hex")

/** Метаданные и immutable файлы фикстуры; компилятор и браузер не запускаются. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "shared-receipt-"))
  roots.push(root)
  const source = join(root, "source.ts")
  const assets = (version: string): SharedBrowserAssets => {
    writeFileSync(source, version)
    const paths = [`kernel/${version}.js`, `entries/page-${version}.js`, `entries/bootstrap-${version}.js`, `styles/${version}.css`]
    for (const path of paths) {
      mkdirSync(dirname(join(root, path)), {recursive: true})
      writeFileSync(join(root, path), `${version}:${path}`)
    }
    return {root, landingEntry: paths[1]!, fallbackEntry: paths[1]!, bootstrapEntry: paths[2]!, dependencyRealpaths: [source],
      artifactDigests: paths.map(path => ({path, digest: digest(`${version}:${path}`)})),
      authorStyleSheets: [{specifier: "@zavx0z/ui/theme.css", url: paths[3]!, contentDigest: digest(`${version}:${paths[3]}`)}],
      browserIdentity: Environment.identity(`/__storybook/shared/${paths[1]}`,
        [{specifier: "@zavx0z/component", sourcePath: source, url: `/__storybook/shared/${paths[0]}`}],
        digest(`host:${version}`), [{path: source, contentDigest: digest(version)}]),
    }
  }
  return {root, source, assets}
}

test("предыдущая kernel identity сохраняется после замены текущего receipt и исходников", () => {
  const f = fixture()
  const first = f.assets("first")
  saveSharedBrowserReceipt(first)
  const second = f.assets("second")
  saveSharedBrowserReceipt(second)
  expect(() => Environment.validate(first.browserIdentity!)).toThrow("source changed")
  expect(readSharedBrowserEpoch(f.root, first.browserIdentity!.epoch)?.browserIdentity).toEqual(first.browserIdentity)
  expect(readSharedBrowserEpoch(f.root, second.browserIdentity!.epoch)?.bootstrapEntry).toBe(second.bootstrapEntry)
  expect(readSharedBrowserEpoch(f.root, "a".repeat(64))).toBeNull()
})

test("host для сохранённого kernel не заменяет текущую платформу", () => {
  const f = fixture()
  const first = f.assets("first")
  saveSharedBrowserReceipt(first)
  const second = f.assets("second")
  saveSharedBrowserReceipt(second)
  const variant = {...first, browserIdentity: {...first.browserIdentity!, hostModuleEpoch: second.browserIdentity!.hostModuleEpoch}}
  saveSharedBrowserReceipt(variant, false)
  expect(JSON.parse(readFileSync(join(f.root, "receipt.json"), "utf8")).assets.browserIdentity.epoch).toBe(second.browserIdentity!.epoch)
  expect(readSharedBrowserEpoch(f.root, first.browserIdentity!.epoch)?.browserIdentity?.hostModuleEpoch).toBe(second.browserIdentity!.hostModuleEpoch)
})

test("изменённые immutable байты не принимаются как сохранённая платформа", () => {
  const f = fixture()
  const first = f.assets("first")
  saveSharedBrowserReceipt(first)
  writeFileSync(join(f.root, "kernel/first.js"), "changed")
  const rejected: string[] = []
  expect(readSharedBrowserEpoch(f.root, first.browserIdentity!.epoch, undefined, reason => { rejected.push(reason) })).toBeNull()
  expect(rejected.some(reason => reason.includes("Хеш артефакта не совпадает"))).toBeTrue()
})


test("подготовленный набор не меняет опубликованный, публикация сохраняет совместимый host", () => {
  const f = fixture()
  const first = f.assets("first")
  saveSharedBrowserReceipt(first)
  const second = f.assets("second")
  saveSharedBrowserCandidate(second, true)
  const variant = {...first, browserIdentity: {...first.browserIdentity!, hostModuleEpoch: second.browserIdentity!.hostModuleEpoch}}
  saveSharedBrowserCandidate(variant, false)
  const input = {root: f.root, toolRoot: f.root, stagingDirectory: f.root, landingEntryPath: "", fallbackEntryPath: ""}
  expect(readPublishedSharedBrowserReceipt(input)?.browserIdentity).toEqual(first.browserIdentity)
  saveSharedBrowserReceipt({...second, compatibleHosts: [{sharedModuleEpoch: first.browserIdentity!.epoch, hostModuleEpoch: second.browserIdentity!.hostModuleEpoch}]})
  expect(readPublishedSharedBrowserReceipt(input)?.browserIdentity).toEqual(second.browserIdentity)
  expect(readSharedBrowserEpoch(f.root, first.browserIdentity!.epoch)?.browserIdentity).toEqual(variant.browserIdentity)
  expect(readSharedBrowserEpoch(f.root, first.browserIdentity!.epoch, first.browserIdentity!.hostModuleEpoch)?.browserIdentity).toEqual(first.browserIdentity)
})

test("архивная платформа сохраняет владельцев после переименования пакетов", () => {
  const f = fixture()
  const first = f.assets("first")
  const modules = first.browserIdentity!.modules.map(module => ({...module, specifier: "@retired-platform/component"}))
  const historical = {...first, browserIdentity: {...first.browserIdentity!, modules,
    epoch: digest(JSON.stringify({modules: modules.map(({specifier, url}) => ({specifier, url}))}))}}
  saveSharedBrowserReceipt(historical)
  const second = f.assets("second")
  saveSharedBrowserReceipt(second)
  rmSync(f.source)

  expect(() => Environment.validate(historical.browserIdentity)).toThrow("Unknown shared")
  expect(readSharedBrowserEpoch(f.root, historical.browserIdentity.epoch)?.browserIdentity).toEqual(historical.browserIdentity)
  writeFileSync(join(f.root, "kernel/first.js"), "corrupt")
  expect(readSharedBrowserEpoch(f.root, historical.browserIdentity.epoch)).toBeNull()
})
