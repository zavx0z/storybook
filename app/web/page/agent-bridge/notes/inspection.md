# Инспекция и действия в живой странице

[Agent bridge](../index.ts) использует существующую [среду страницы](../../notes/experience.md). [Проверки](../spec/scenario.spec.ts) уточняют наблюдаемое поведение.

Inspection и interaction используют existing semantic Document, Workbench IDs
и renderer frame. Target resolution exact nodeId либо exact role+name;
ambiguity fail closed. Raw eval/coordinates не являются agent API.
Узел с потомками возвращает `subtreeCursor`. Повторная инспекция с этим cursor
начинает обход от выбранного узла: глубина считается заново, размер страницы
остаётся ограниченным, а `nodeId` сохраняется. Так агент доходит до поля
внутри вложенного Workbench и обращается к нему по точному ID даже при
совпадающих названиях в сценарии и Inspector. Имена полей читаются из
`aria-label`, `aria-labelledby` и связанных native `label`; у select есть
семантическая роль `combobox` либо `listbox`.
State и inspect возвращают nativePage.visibilityState и nativePage.hasFocus
из native shell.browserDocument рядом с неизменными revision и frameSequence.
Это чтение текущей видимости и фокуса страницы без нового кадра, RAF, таймера
или смены фокуса; недоступное значение равно null. Semantic Document и
canvas.hidden не заменяют состояние native страницы. Эти поля не утверждают
наличие queued RAF или причину отсутствия нового presented frame.
Для pointer и wheel выбирается hit текущего кадра, при его отсутствии — box.
Центр сначала преобразуется CSS scale/translate выбранной записи, затем ровно
одним Browser.projectPoint из viewport проекции в клиентские координаты.
Для path с presentationOwner используется актуальный frame.presentationTransforms
с fallback на hit.transform; обычные кнопки используют hit.transform.
У пространственного target сохраняется центр preview Workbench с его CSS transform.
getBoundingClientRect уже содержит клиентские координаты и повторно не проецируется.
Нечисловые точки отклоняются до доставки ввода. Regression agent-bridge использует
реальный hitTestProjection и обработчик кнопки при scale 1 и 0.43 с переносом,
проверяя exact role/name, nodeId и fallback на box.
`createDomInspector` импортируется из `@zavx0z/immersive-devtool` в Immersive. Этот владелец
предоставляет снимки, стабильные идентификаторы и освобождение ссылок;
`readFrame(node)` читает готовый кадр нужной projection единственного Root.
Диагностические панели и команды агента не требуют исходный Renderer checkout.
`key` активирует exact Workbench Display owner в существующем Browser Root,
фокусирует semantic target и вызывает `root.dispatchKey(...)` только
после проверки exact Document/owner/target/native proxy. Modifiers сохраняются;
ownership/proxy mismatch fail closed. Bridge не fabricate-ит semantic
`KeyboardEvent`, поэтому Browser-owned Escape, Range и Select defaults
исполняются одним input owner. Exact proxy берётся только
из `browserDocument.activeElement`: input/textarea сверяются по public host
identity, select — по Renderer-owned `data-renderer-select-proxy`; native DOM
scan отсутствует. После `keydown` Root синхронизируется повторно: если default
action восстановил focus внутри того же Workbench owner, `keyup` идёт через его
текущий exact proxy, а не через stale target.
Это bounded agent adapter с browser-realm event (`isTrusted === false`): он
доказывает Renderer/Browser-host defaults, но не заявляет OS keyboard, Tab
navigation или native Button activation.
State/inspection публикуют только singular `canvas` exact текущего Root;
plural canvas discovery отсутствует. Capture area `canvas` всегда означает этот
же единственный host Canvas.
