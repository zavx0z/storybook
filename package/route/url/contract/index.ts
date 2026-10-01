/** Контракт чистого публичного URL пакета Storybook. */
export declare namespace RouteUrl {
  /**
  Browser-safe функции построения, сравнения и чтения адреса.

  @property storybookPackagePathSegment - Переводит package ID в читаемый
  сегмент и отклоняет неверную identity.

  @property storybookPackagePathMatches - Принимает читаемый и ранее
  опубликованный закодированный сегмент известного пакета.

  @property storybookPackageUrlPath - Строит путь страницы пакета и его
  структурный маршрут без обращения к Chrome.

  @property storybookPackageRouteFromPathname - Извлекает маршрут только
  известного пакета, возвращая null при несовпадении или неверном сегменте.

  @property storybookCurrentRouteKey - Преобразует старый ключ директории
  в структурные `dir-` сегменты.

  @property validViewQuery - Проверяет единственные допустимые параметры
  preview, inspector, view и variant у разобранного URL.
  */
  type Output = Readonly<{
    storybookPackagePathSegment(packageId: string): string
    storybookPackagePathMatches(segment: string, packageId: string): boolean
    storybookPackageUrlPath(packageId: string, route?: string): string
    storybookPackageRouteFromPathname(pathname: string, packageId: string): string | null
    storybookCurrentRouteKey(route: string): string
    validViewQuery(url: URL): boolean
  }>
}
