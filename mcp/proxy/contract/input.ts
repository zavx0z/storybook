/**
Запрос к HTTP-серверу Storybook без интерпретации предметных данных в прокси.

Пустой запрос запрашивает доступные разделы и инструкции сервера.

@property [node] - Адресуемый раздел; допустимые значения определяет HTTP-сервер.

@property [action] - Действие выбранного раздела; передаётся серверу без преобразования.

@property [input] - Параметры действия. Их поля и ограничения определяет HTTP-сервер.
*/
export interface StorybookProxyInput {
  readonly node?: string | undefined
  readonly action?: string | undefined
  readonly input?: Record<string, unknown> | undefined
}
