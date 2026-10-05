/**
Адрес без UUID выбирает прежнюю default-беседу. Точная identity исполнителя
выбирает уже существующую беседу этого предмета и не создаёт её неявно.
*/
export type Target = string | Readonly<{address: string, executorId: string}>
