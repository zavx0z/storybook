import {beforeAll, expect, test} from "bun:test"
import {createDocument} from "@zavx0z/dom"
import {createDocumentRenderer} from "@renderer/html"
import {loadCompiledWorkbench} from "./fixture/compile-workbench"
import Limits from "@tech/limits"

let api: Awaited<ReturnType<typeof loadCompiledWorkbench>>
beforeAll(async () => { api = await loadCompiledWorkbench() }, Limits.STORYBOOK_SHARED_COMPILE_TIMEOUT_MS)
const theme = await Bun.file(new URL(import.meta.resolve("@zavx0z/ui/theme/theme.css"))).text()

test("реальная прокрутка обновляет окно строк каталога без ручного dispatchEvent", async () => {
  const document = createDocument()
  const workbench = api.createWorkbench({
    document,
    parent: document,
    initial: {
      "catalog.items": Array.from({length: 200}, (_, index) => ({
        id: `item-${index}`, label: `Строка ${index}`, route: `/items/${index}`,
      })),
      "catalog.active": "item-150",
    },
  })
  const renderer = createDocumentRenderer({
    document, root: workbench.element, viewport: {width: 1000, height: 720}, styleSheets: [theme],
  })
  const tree = workbench.elements.catalogItems
  let scrollEvents = 0
  tree.addEventListener("scroll", () => { scrollEvents++ })
  try {
    renderer.flush()
    tree.scrollTop = 2400
    renderer.flush()
    await new Promise(resolve => setTimeout(resolve, 0))
    workbench.componentRoot.flush()
    renderer.flush()
    expect({
      scrollTop: tree.scrollTop,
      notified: scrollEvents > 0,
      windowMoved: Number(tree.getAttribute("data-tree-window-start")) > 0,
    }, "После настоящей прокрутки Tree получает scroll и материализует строки текущей области").toEqual({
      scrollTop: 2400,
      notified: true,
      windowMoved: true,
    })
  } finally {
    renderer.dispose()
    workbench.dispose()
  }
})
