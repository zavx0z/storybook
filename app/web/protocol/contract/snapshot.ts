import type {PackageGraphCreate} from "@package-graph/create"
import type {PackageSession} from "@package/session"
import type {ExternalStorybookClientNode, ExternalStorybookClientPackageSummary} from "./client"

/** Подготовленный граф и ровно по одному снимку сессии на каждый пакет. */
export type ClientSnapshotInput = [
  graph: PackageGraphCreate.Output,
  sessionSnapshots: readonly ReturnType<PackageSession.Output["snapshot"]>[],
]

/**
Согласованный снимок графа и сессий пакетов для страницы Storybook.

@property protocol - Маркер версии браузерного протокола.

@property graphDigest - Контрольный отпечаток исходного графа.

@property rootIds - Идентификаторы корней в порядке исходного графа.

@property nodes - Сериализованные узлы графа.

@property packages - Сводки сессий обнаруженных пакетов.
*/
export type ClientSnapshot = Readonly<{
  protocol: "external-storybook-client/1"
  graphDigest: string
  rootIds: readonly string[]
  nodes: readonly ExternalStorybookClientNode[]
  packages: readonly ExternalStorybookClientPackageSummary[]
}>
