import type {
  WorkbenchBreadcrumb,
  ExternalStorybookClientSnapshot,
  BrowserGraph,
  ExternalStorybookBrowserNavigationItem,
  ExternalStorybookLandingModel,
  ExternalStorybookLandingSelection,
  ExternalStorybookPackageTabModel,
  StorybookBreadcrumbScope,
} from "./types"

export declare namespace StorybookAppWebPageNavigation {
  /** Проекции физического графа и передача намерения перехода владельцу страницы. */
  export type Output = Readonly<{
    /** Проецирует физических владельцев пакетов в дерево общего каталога. */
    deriveExternalStorybookLanding(graph: BrowserGraph): ExternalStorybookLandingModel
    /** Сочетает состав применённой ревизии пакета с его положением в общем графе. */
    deriveExternalStorybookNavigationTree(
      graph: BrowserGraph,
      exactPackage?: Readonly<{packageId: string; graph: BrowserGraph}>,
    ): readonly ExternalStorybookBrowserNavigationItem[]
    deriveExternalStorybookLandingSelection(graph: BrowserGraph, nodeId: string): ExternalStorybookLandingSelection
    /** Предоставляет обзор и имеющиеся у владельца структурные вкладки. */
    deriveExternalStorybookPackageTab(
      graph: BrowserGraph,
      packageId: string,
      routePath: string,
    ): ExternalStorybookPackageTabModel
    /** Домашняя ссылка сохраняет общий адрес каталога и получает имя текущего Project. */
    storybookRootBreadcrumb(projectName: string): WorkbenchBreadcrumb
    /** Выводит путь из точного графа браузера; имя Project принадлежит его корневой ссылке. */
    deriveStorybookBreadcrumbs(
      graph: ExternalStorybookClientSnapshot,
      selectedId: string,
      scope: StorybookBreadcrumbScope,
    ): readonly WorkbenchBreadcrumb[]
    /**
    Передаёт package intent единственному page owner без browser navigation fallback.

    @param input - Exact packageId и route, которые server resolver проверит перед mount.

    @param transition - Page-owned callback; direct scope не может менять `location` самостоятельно.

    @returns Завершение committed transition либо её rollback.

    @throws Если scope запущен без page controller или transition отклонена.

    @example
    ```ts
    await Navigation.navigatePackage(
      {packageId: "@immersive/markdown", route: ""},
      page.navigatePackage,
    )
    ```
    */
    navigatePackage(
      input: Readonly<{packageId: string; route: string}>,
      transition?: (input: Readonly<{packageId: string; route: string}>) => Promise<void>,
    ): Promise<void>
    STORYBOOK_ROOT_BREADCRUMB: Readonly<Omit<WorkbenchBreadcrumb, "label">>
  }>
}
