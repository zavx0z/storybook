/** Публичный адрес точного представления узла пакета. */
export type GraphRoute = Readonly<{
  packageId: string
  path: string
  urlPath: string
  kind: "overview" | "dependencies" | "contract" | "scenarios"
  nodeId: string
}>
