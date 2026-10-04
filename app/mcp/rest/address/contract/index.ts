/** Контракт точного адреса публичного направления MCP. */
export declare namespace StorybookAppMcpRestAddress {
  /** Адрес без query/fragment и список действительно присутствующих путей. */
  type Input = Readonly<{address: string; paths: readonly string[]}>

  /** Проверенный неизменённый адрес. */
  type Output = string
}
