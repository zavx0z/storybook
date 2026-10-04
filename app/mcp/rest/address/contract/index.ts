/** Контракт точного адреса публичного направления MCP. */
export declare namespace StorybookAppMcpRestAddress {
  /** Адрес без query/fragment и список действительно присутствующих путей. */
  type Input = Readonly<{address: string; paths: readonly string[]}>

  /** Проверенный внутренний адрес без начального ./; root обрабатывает вызывающий маршрутизатор. */
  type Output = string
}
