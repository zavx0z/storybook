/**
Запрос к HTTP-серверу Storybook без интерпретации предметных данных в прокси.

Пустой запрос запрашивает доступные разделы и инструкции сервера.

@property [path] - Точный адрес выбранного элемента children без параметров URL
и fragment. Отсутствие поля выбирает независимый корневой вход MCP.
*/
export interface StorybookProxyInput {
  readonly path?: string | undefined
}
