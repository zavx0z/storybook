import {expect, test} from "bun:test"
import WebProtocol from "@app-web/protocol"
type StorybookSharedHost = ReturnType<typeof WebProtocol.validateSharedHost>

const host: StorybookSharedHost = {
  protocol: "storybook-shared-host/1",
  sharedModuleEpoch: "a".repeat(64), hostModuleEpoch: "b".repeat(64),
  pageEntryUrl: "/__storybook/shared/entries/page-a.js",
  packageHostUrl: "/__storybook/shared/entries/package-a.js",
  authorStyleSheets: [{specifier: "@storybook/theme", contentDigest: "c".repeat(64), url: "/__storybook/shared/styles/theme-c.css"}],
}

test("оболочка запрашивается для exact kernel с reader grant", async () => {
  const requests: [string, RequestInit | undefined][] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push([String(input), init])
    return Response.json(host)
  }) as unknown as typeof fetch
  const signal = new AbortController().signal
  expect(await WebProtocol.readSharedHost(fetcher, "reader-grant", signal, host.sharedModuleEpoch)).toEqual(host)
  expect(requests).toEqual([[`/api/browser/shared?sharedModuleEpoch=${host.sharedModuleEpoch}`, {
    headers: {"x-storybook-session": "reader-grant"}, signal,
  }]])
})

test("другая платформа не подменяет неподготовленную совместимую оболочку", async () => {
  const fetcher = (async () => Response.json({...host, sharedModuleEpoch: "d".repeat(64)})) as unknown as typeof fetch
  await expect(WebProtocol.readSharedHost(fetcher, "reader", new AbortController().signal, host.sharedModuleEpoch))
    .rejects.toThrow("другую платформу")
})

test.each(["https://other.example/code.js", "//other.example/code.js", "/__storybook/shared/../private.js", "/__storybook/shared/%2e%2e/private.js"])(
  "не импортирует адрес за границей immutable shared assets: %s", pageEntryUrl => {
    expect(() => WebProtocol.validateSharedHost({...host, pageEntryUrl})).toThrow()
  },
)

test("отсутствующая историческая платформа остаётся явной ошибкой", async () => {
  const fetcher = (async () => new Response("missing", {status: 409})) as unknown as typeof fetch
  await expect(WebProtocol.readSharedHost(fetcher, "reader", new AbortController().signal, host.sharedModuleEpoch)).rejects.toThrow("409")
})

test("bootstrap не загружает платформу до выбора совместимого host", async () => {
  const scanner = new Bun.Transpiler({loader: "ts"})
  for (const [source, expected] of [
    ["../../src/runtime/shared-bootstrap.ts", ["@app-web/protocol", "./page-target"]],
    ["../src/shared-host.ts", []],
    ["../../src/runtime/page-target.ts", []],
  ] as const) {
    const imports = scanner.scanImports(await Bun.file(new URL(source, import.meta.url)).text())
    expect(imports.filter(item => item.kind !== "dynamic-import").map(item => item.path))
      .toEqual([...expected])
  }
})
