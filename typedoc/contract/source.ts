/**
Тег, разобранный штатным TypeScript checker; Markdown и inline-ссылки сохраняются текстом.


@property name - Имя без символа `@`, например `param` или `typeParam`.

@property text - Содержимое тега; у именованных тегов включает имя параметра или свойства.
*/
export type Tag = Readonly<{name: string, text: string}>

/**
Собственное объявление и независимые от комментария факты его сигнатуры.


@property name - Имя исходного объявления; namespace родителей включён для различения ролей.

@property line - Строка объявления, начиная с единицы.

@property summary - Описание, извлечённое TypeScript; пустая строка означает отсутствие описания.

@property comments - Исходные doc-блоки для проверки оформления; модульный обзор исключён.

@property tags - Теги того же символа, разобранные TypeScript.

@property parameters - Имена параметров функции или метода из AST, включая деструктуризацию как текст.

@property typeParameters - Имена generic-параметров из AST.

@property properties - Имена полей и методов объектной формы, описываемых через `@property` родителя.

@property callables - Имена вызываемых членов объектной формы, включая функции, полученные через indexed access.

@property inlineProperties - Члены объектной формы с собственными doc-блоками вместо `@property` у содержащей формы.

@property returns - Тип результата callable-объявления; `null` для остальных объявлений.

@property throws - Наличие собственного `throw` в теле функции; вызовы чужого кода не анализируются.
*/
export type Declaration = Readonly<{
  name: string
  line: number
  summary: string
  comments: readonly string[]
  tags: readonly Tag[]
  parameters: readonly string[]
  typeParameters: readonly string[]
  properties: readonly string[]
  callables: readonly string[]
  inlineProperties: readonly string[]
  returns: string | null
  throws: boolean
}>

/**
Документация выбранного файла с привязкой к прочитанному исходнику.


@property path - Абсолютный физический путь.

@property digest - SHA-256 полного исходного текста, включая комментарии.

@property module - Обзор, полученный штатным читателем модульного TSDoc; `null`, если блока нет.

@property declarations - Собственные именованные объявления, включая типы и методы внутри namespace.
*/
export type Source = Readonly<{
  path: string
  digest: string
  module: string | null
  declarations: readonly Declaration[]
}>
