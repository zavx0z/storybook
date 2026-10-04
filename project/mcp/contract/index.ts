/** Предметный ответ Project при входе агента в проект. */
export declare namespace StorybookProjectMcp {
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

  @property label - Имя Project независимо от наличия Repo.

  @property description - Порядок дальнейшего чтения через инструмент storybook.

  @property children - Только Repo верхнего уровня в порядке каталога.
  Адрес сохраняется без изменения. Описание содержит первый абзац summary,
  а при отсутствии summary — description. Пустой текст обозначает отсутствие
  авторского описания. Необязательная подпись сохраняется, если она непустая
  и не повторяет последний сегмент адреса или полное слово в начале описания.
  Сравнение подписи не учитывает регистр и крайние пробелы.
  Корневой ответ не содержит path: к Project обращаются пустым вызовом.
  */
  type Output = Readonly<{
    label: string
    description: string
    children: readonly Readonly<{
      path: string
      label?: string
      description: string
    }>[]
  }>
}
