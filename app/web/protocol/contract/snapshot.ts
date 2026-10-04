import type {Zavx0zStorybookPackageGraphCreate} from "@zavx0z/storybook-package-graph-create"
import type {Zavx0zStorybookPackageSession} from "@zavx0z/storybook-package-session"
import type {ExternalStorybookClientNode, ExternalStorybookClientPackageSummary} from "./client"

/** Подготовленный граф, ровно по одному снимку сессии пакета и имя общего Project. */
export type ClientSnapshotInput = [
  graph: Zavx0zStorybookPackageGraphCreate.Output,
  sessionSnapshots: readonly ReturnType<Zavx0zStorybookPackageSession.Output["snapshot"]>[],
  projectName: string,
]

/**
Согласованный снимок графа и сессий пакетов для страницы Storybook.

@property protocol - Маркер версии браузерного протокола.

@property projectName - Имя Project из его package.json, общее для каталога и домашней ссылки.

@property graphDigest - Контрольный отпечаток исходного графа.

@property rootIds - Идентификаторы корней в порядке исходного графа.

@property nodes - Сериализованные узлы графа.

@property packages - Сводки сессий обнаруженных пакетов.
*/
export type ClientSnapshot = Readonly<{
  protocol: "external-storybook-client/1"
  projectName: string
  graphDigest: string
  rootIds: readonly string[]
  nodes: readonly ExternalStorybookClientNode[]
  packages: readonly ExternalStorybookClientPackageSummary[]
}>
