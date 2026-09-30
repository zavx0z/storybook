/**
Измеренный итог по корневому процессу и его обнаруженным потомкам.
Отсутствующий корень либо несовпадающая метка старта дают `null`.

@property descendantCount - Число найденных потомков без корневого процесса.

@property cpuPercent - Сумма реальных `%CPU`; `null`, если хотя бы для одного
процесса дерева значение недоступно.

@property rssBytes - Сумма реальных RSS в байтах; `null`, если хотя бы для
одного процесса дерева значение недоступно.
*/
export type MeasuredResources = Readonly<{
  cpuPercent: number | null
  rssBytes: number | null
  descendantCount: number
}> | null
