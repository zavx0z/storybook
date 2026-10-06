/** Предметный ответ Project при входе агента в проект. */
export declare namespace StorybookAppKnowledgeProject {
  /**
  Идентичность Project и навигация по его уже обнаруженному составу.

  @property projectName - Точное непустое имя из package.json Project.
  Не зависит от состава Repo и не становится префиксом их адресов.

  @property entries - Публичные направления каталога текущего Project.
  Repo имеют parent: null; вложенные направления сохраняют адрес своего родителя.
  Пустой массив обозначает Project без доступных направлений.
  */
  type Input = Readonly<{
    projectName: string
    entries: readonly Readonly<{
      path: string
      label?: string
      description: string
      summary?: string
      parent: string | null
    }>[]
  }>

  /**
  Корневой ответ с собственной идентичностью и непосредственными переходами к Repo.

  @property path - Точка обозначает root подключения.

  @property label - Имя Project независимо от наличия Repo.

  @property description - Порядок дальнейшего чтения через инструмент storybook.

  @property children - Только Repo верхнего уровня в порядке каталога.
  Адрес начинается с ./ и отсчитывается от root. Описание содержит первый абзац summary,
  а при отсутствии summary — description. Пустой текст обозначает отсутствие
  авторского описания. Необязательная подпись сохраняется, если она непустая
  и не повторяет последний сегмент адреса или полное слово в начале описания.
  Сравнение подписи не учитывает регистр и крайние пробелы.
  Корневой ответ содержит path: ".". К Project возвращаются пустым вызовом либо path: ".".
  */
  type Output = Readonly<{
    path: "."
    label: string
    description: string
    children: readonly Readonly<{
      path: string
      label?: string
      description: string
    }>[]
  }>
}
