/**
Единый ответ навигации для проекта, компонента, библиотеки и корневого входа.

@property [path] - Адрес текущего направления; у корневого входа отсутствует.

@property [label] - Дополнительное название, которое не повторяет последний
сегмент пути или начало описания. У корня без пути название сохраняется.

@property description - Назначение или явное сообщение об отсутствии описания.

@property children - Непосредственно доступные переходы. label называет направление,
description помогает выбрать его, path передаётся следующему вызову storybook.
Содержимое соседних ветвей заранее не раскрывается; пустой массив означает,
что дальнейших переходов на этом уровне нет.
*/
export interface ReadMcpChildrenOutput {
  readonly path?: string
  readonly label?: string
  readonly description: string
  readonly children: readonly {
    readonly path: string
    readonly label?: string
    readonly description: string
  }[]
}
