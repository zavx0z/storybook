/** Контракт непрозрачной доставки предметного адреса действующему серверу. */
export declare namespace StorybookAppMcpProxy {
  /** Пустой запрос открывает корень, path выбирает точный адрес из children. */
  type Input = Readonly<{path?: string | undefined}>

  /** JSON-объект HTTP-ответа без предположений о предметных полях. */
  type Output = Readonly<Record<string, unknown>>
}
