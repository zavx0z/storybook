import type {StorybookPackageMcp} from "@zavx0z/storybook-package-mcp"

/** Предметное чтение Container из сведений выбранного владельца. */
export declare namespace StorybookContainerMcp {
  /** Выбранный владелец и разрешённые переходы; готовый HTTP-ответ сюда не передаётся. */
  type Input = Omit<StorybookPackageMcp.Input, "includeContent">
  /** Назначение, непосредственные переходы, JSON Schema и исходники сценариев. */
  type Output = StorybookPackageMcp.Output
}
