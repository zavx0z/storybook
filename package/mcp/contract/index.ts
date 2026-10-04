import type {StorybookPackageMcpSource} from "@zavx0z/storybook-package-mcp-source"
import type {StorybookPackageMcpNavigation} from "@zavx0z/storybook-package-mcp-navigation"
import type {StorybookPackageMcpContent} from "@zavx0z/storybook-package-mcp-content"

/** Общая форма чтения Package, используемая предметными владельцами. */
export declare namespace StorybookPackageMcp {
  type Input = Readonly<{
    selected: StorybookPackageMcpSource.Output[number]
    entries: StorybookPackageMcpSource.Output
    /** До подтверждения типа маршрутизатор запрашивает только навигацию. */
    includeContent?: boolean
  }>
  type Output = StorybookPackageMcpNavigation.Output & StorybookPackageMcpContent.Output
}
