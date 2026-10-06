# Состав проекта

[Project](../../index.ts) читает собственное имя Git superproject и объявленные
в `.gitmodules` ссылки на независимые пакеты Repo.
Repo владеет общей Git-историей и вложенными пакетами Domain, Component и
[Container](../../../container/src/architecture.md).
Одинаковая пакетная форма сохраняется на всех уровнях внутри Repo.

Каноническая схема и границы классов находятся в
[едином стандарте структуры](../../../package/src/architecture.md).
