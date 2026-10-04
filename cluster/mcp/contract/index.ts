import type {Zavx0zStorybookPackageMcp} from "@zavx0z/storybook-package-mcp"

/** Предметное чтение Cluster из сведений выбранного владельца. */
export declare namespace Zavx0zStorybookClusterMcp {
  /** Выбранный владелец и разрешённые переходы; готовый HTTP-ответ сюда не передаётся. */
  type Input = Omit<Zavx0zStorybookPackageMcp.Input, "includeContent">
  /** Назначение, непосредственные переходы, JSON Schema и исходники сценариев. */
  type Output = Zavx0zStorybookPackageMcp.Output
}
