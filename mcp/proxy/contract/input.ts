/** Стабильная оболочка запроса; допустимый смысл node, action и input определяет HTTP-сервер. */
export interface StorybookProxyInput {
  readonly node?: string | undefined
  readonly action?: string | undefined
  readonly input?: Record<string, unknown> | undefined
}
