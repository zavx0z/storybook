# Состав проекта

[Project](../../index.ts) читает собственное имя Git superproject и объявленные
в `.gitmodules` ссылки на независимые пакеты Repo.
Repo владеет общей Git-историей и вложенными пакетами Domain, Component и
[Container](../../../container/meta/notes/structure.md).
Одинаковая пакетная форма сохраняется на всех уровнях внутри Repo.

Каноническая схема и границы классов находятся в
[едином стандарте структуры](../../../package/meta/notes/draft-structure.md).
