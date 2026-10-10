import {expect, test} from "bun:test"
import {createDocument, DOMGroup} from "@zavx0z/immersive"
import type {WorkbenchElements} from "../contract/workbench"
import {syncWorkbenchPresentation, validateWorkbenchPresentation} from "../src/presentation"

test("проекция переносит полный диапазон и освобождает прежнее содержимое", () => {
  const document = createDocument()
  const displayHost = document.createElement("section")
  const hudHost = document.createElement("aside")
  const spaceHost = document.createElement("div")
  const owner = document.createElement("main")
  document.append(owner)
  owner.append(displayHost, hudHost, spaceHost)
  const elements = {displayHost, hudHost, spaceHost} as WorkbenchElements
  const button = document.createElement("button")
  const sibling = document.createElement("span")
  const content = new DOMGroup(document, button, sibling)
  const first = validateWorkbenchPresentation({node: content, projection: "display"}, document)
  syncWorkbenchPresentation(null, first, elements, document)
  button.focus()
  const second = validateWorkbenchPresentation({node: content, projection: "hud"}, document)
  syncWorkbenchPresentation(first, second, elements, document)
  expect(displayHost.childNodes.length).toBe(0)
  expect(content.parentNode).toBe(hudHost)
  expect(content.nodes).toEqual([button, sibling])
  expect(document.activeElement).toBe(button)

  const replacement = document.createElement("article")
  syncWorkbenchPresentation(second, {node: replacement, projection: "hud"}, elements, document)
  expect(content.parentNode).toBeNull()
  expect(content.nodes).toEqual([button, sibling])
  expect(hudHost.childNodes).toEqual([replacement])
  expect(() => validateWorkbenchPresentation({node: new DOMGroup(createDocument()), projection: "hud"}, document))
    .toThrow("another Document")
})
