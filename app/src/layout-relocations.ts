import {dirname, relative, resolve} from "node:path"
import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"
import type {StorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"

type Graph = StorybookPackageGraphRead.Input

/** Разовый переход физических адресов App; identity пакетов при переносе сохранена. */
const relocations = [
  {
    "packageId": "@zavx0z/storybook-app-web-page-shell-workbench",
    "previous": "app/web/workbench",
    "current": "app/web/page/shell/workbench"
  },
  {
    "packageId": "@zavx0z/storybook-app-web-page-shell-workbench-catalog",
    "previous": "app/web/catalog",
    "current": "app/web/page/shell/workbench/catalog"
  },
  {
    "packageId": "@zavx0z/storybook-app-web-page-shell-minimap",
    "previous": "app/web/minimap",
    "current": "app/web/page/shell/minimap"
  },
  {
    "packageId": "@zavx0z/storybook-app-web-page-shell-mcp-window",
    "previous": "app/web/mcp-window",
    "current": "app/web/page/shell/mcp-window"
  },
  {
    "packageId": "@zavx0z/storybook-app-web-page-shell-viewpoint-controls",
    "previous": "app/web/viewpoint-controls",
    "current": "app/web/page/shell/viewpoint-controls"
  },
  {
    "packageId": "@zavx0z/storybook-app-web-page-shell-viewpoint-tab",
    "previous": "app/web/viewpoint-tab",
    "current": "app/web/page/shell/viewpoint-tab"
  },
  {
    "packageId": "@zavx0z/storybook-app-web-page-agent-bridge",
    "previous": "app/web/agent-bridge",
    "current": "app/web/page/agent-bridge"
  },
  {
    "packageId": "@zavx0z/storybook-app-web-page-target",
    "previous": "app/web/page-target",
    "current": "app/web/page/target"
  },
  {
    "packageId": "@zavx0z/storybook-app-web-page-client",
    "previous": "app/web/client",
    "current": "app/web/page/client"
  },
  {
    "packageId": "@zavx0z/storybook-app-web-page-navigation",
    "previous": "app/web/navigation",
    "current": "app/web/page/navigation"
  },
  {
    "packageId": "@zavx0z/storybook-app-web-page-status",
    "previous": "app/web/status",
    "current": "app/web/page/status"
  },
  {
    "packageId": "@zavx0z/storybook-app-web-page-style-sheets",
    "previous": "app/web/style-sheets",
    "current": "app/web/page/style-sheets"
  },
  {
    "packageId": "@zavx0z/storybook-app-web-page-presentation",
    "previous": "app/web/presentation",
    "current": "app/web/page/presentation"
  },
  {
    "packageId": "@web/scenario",
    "previous": "app/web/scenario",
    "current": "app/web/page/package/scenario"
  },
  {
    "packageId": "@zavx0z/storybook-specs-reference",
    "previous": "app/web/reference",
    "current": "specs/reference"
  },
  {
    "packageId": "@zavx0z/storybook-tech-testing-browser-root",
    "previous": "app/web/browser-fixture",
    "current": "tech/testing/browser-root"
  }
] as const

/** Сопоставляет только собственные пакеты установленного Storybook с текущим каталогом. */
function subjects(toolRoot: string, graph: Graph) {
  return relocations.flatMap(move => {
    const owner = graph.nodes.find(node => node.kind === "package" && node.packageId === move.packageId)
    const cwd = resolve(toolRoot, move.current)
    if (owner === undefined || resolve(dirname(owner.source.path)) !== cwd) return []
    const suffix = `/${move.current.split("/").map(encodeURIComponent).join("/")}`
    if (!owner.urlPath.endsWith(suffix)) throw new Error(`Не подтверждён адрес перенесённого пакета ${move.packageId}`)
    const repository = owner.urlPath.slice(0, -suffix.length)
    return [{...move, owner, cwd, previousCwd: resolve(toolRoot, move.previous),
      previousAddress: `${repository}/${move.previous.split("/").map(encodeURIComponent).join("/")}`}]
  })
}

/**
Сохраняет беседы существующих предметов до открытия нового server listener.
Только Chat Session читает и изменяет собственные файлы. Истории не объединяются;
конфликт останавливает переход, а исходная история остаётся доступной для восстановления.
*/
export async function relocateAppChats(toolRoot: string, graph: Graph, chats: StorybookChatSession.Output): Promise<void> {
  for (const move of subjects(toolRoot, graph)) {
    for (const node of graph.nodes) {
      if (node.packageId !== move.packageId || node.kind === "unavailable") continue
      if (node.urlPath !== move.owner.urlPath && !node.urlPath.startsWith(`${move.owner.urlPath}/`)) continue
      const cwd = node.kind === "package" || node.kind === "entry" ? dirname(node.source.path) : node.source.path
      const withinOwner = relative(move.cwd, cwd)
      if (withinOwner === ".." || withinOwner.startsWith("../")) throw new Error("Контекст беседы выходит за перенесённого владельца")
      await chats.relocate({
        from: {address: move.previousAddress + node.urlPath.slice(move.owner.urlPath.length), cwd: resolve(move.previousCwd, withinOwner)},
        to: {address: node.urlPath, cwd},
      })
    }
  }
}

/** Старый пользовательский адрес направляется только на существующий адрес того же владельца. */
export function relocatedAppAddress(toolRoot: string, graph: Graph, pathname: string): string | null {
  for (const move of subjects(toolRoot, graph)) {
    if (pathname !== move.previousAddress && !pathname.startsWith(`${move.previousAddress}/`)) continue
    const next = move.owner.urlPath + pathname.slice(move.previousAddress.length)
    if (graph.nodes.some(node => node.packageId === move.packageId && node.urlPath === next && node.kind !== "unavailable")) return next
  }
  return null
}
