# Материалы исследования памяти 4 октября 2026

Свидетельства распределены по пакетам-владельцам. Исходники движка не изменялись.
Замеры относятся к конкретным контекстам страницы. Подтверждённые затраты,
расчётная GPU-память и гипотеза HMR разделены в TODO владельцев.

## Владельцы

* [immersive/engine](../../../../../../immersive/engine/meta/todo.md)
* [immersive/webgpu](../../../../../../immersive/webgpu/meta/todo.md)
* [immersive/browser](../../../../../../immersive/browser/meta/todo.md)
* [immersive/devtool](../../../../../../immersive/devtool/meta/todo.md)
* [immersive/ui/component/view/code-editor](../../../../../../immersive/ui/component/view/code-editor/meta/todo.md)

## Архив исходных данных и методик

JSON и CPU-профили скопированы без изменений. Скрипты сохранены с расширением
`.ts.txt` как материалы методики, чтобы их не включали компиляция и discovery.
Их относительные импорты рассчитаны на исходное место `storybook/tmp/performance`;
для воспроизведения требуется восстановить там файл без `.txt` и повторно проверить
доступность целевой страницы. Они не запускаются автоматически. CDP применялся
по прямому поручению пользователя; архив не меняет правила работы через MCP.

| Исходный материал | Сохранённый файл | SHA-256 |
| --- | --- | --- |
| after-live.json | [файл](../../../../../../immersive/ui/component/view/code-editor/meta/research/2026-10-04/after-live.json) | 5914d58d7da01aeb4ffb3866c3888fbc90a90a7bef0adba59c2b2a403031d528 |
| after-live.ts | [файл](../../../../../../immersive/ui/component/view/code-editor/meta/research/2026-10-04/after-live.ts.txt) | 7bc53e48f9a082ecf2bc7301151424e04d079fa8b97b3b777ae86e5900c2e203 |
| after-toggle-4.json | [файл](../../../../../../immersive/webgpu/meta/research/2026-10-04/after-toggle-4.json) | df6c98091345973be3a656adaeedb42ce64566d368e43ddaa6d27451ee6a5c94 |
| after-toggle.json | [файл](../../../../../../immersive/webgpu/meta/research/2026-10-04/after-toggle.json) | e08eca1996b059de3d8e9aec624a82c9ebd4e5723f5cc532eef3691eaa64fe6e |
| after.json | [файл](../../../../../../immersive/ui/component/view/code-editor/meta/research/2026-10-04/after.json) | 1da21509516e8ef66cb4833c25228a39cda95dd8f2c61500ae3ce8f92e26fe4f |
| before-retained.json | [файл](../../../../../../immersive/ui/component/view/code-editor/meta/research/2026-10-04/before-retained.json) | 0385f73e0712899a09a9be3d47ec5a83b62681ef582a09275730eede3f6b289f |
| buffers.json | [файл](../../../../../../immersive/webgpu/meta/research/2026-10-04/buffers.json) | 016546fb502ace1f6a39c192cab1e7101f9fa6b71f9925dd90a6a91369805d71 |
| buffers.ts | [файл](../../../../../../immersive/webgpu/meta/research/2026-10-04/buffers.ts.txt) | 444d0c2b238b57322f76a113bd7fc030a489fc28c4f59e91dd09f67a87ab7857 |
| catalog-size.json | [файл](catalog-size.json) | d0b26560af46cddf53d2c39f7b2d7310a6ad3555870cd36e498724b974a7a920 |
| catalog-size.ts | [файл](catalog-size.ts.txt) | 0b5238e56e186e83247d36c9a3da124aff39ee5d80061c0952d8a458ee05f277 |
| current.cpuprofile | [файл](../../../../../../immersive/devtool/meta/research/2026-10-04/current.cpuprofile) | f8f82bee15f796aa76cfc528e14f9be548f3881e1c357e636000653dbb4469e5 |
| current.json | [файл](../../../../../../immersive/devtool/meta/research/2026-10-04/current.json) | 7a1c98d057da040b1ac944e496696f071b5e2d0ae6203204865459d2bf2022b7 |
| findings.json | [файл](findings.json) | 67200143fe9911950a1a2c2daa10ab890f9d2bda30b69b78b540c4e7834f9ff7 |
| full-response-test.log | [файл](full-response-test.log) | 8d268f8b537d4409d2598bf4be17048d3a29b08b68bd5682816a29644c8ebe73 |
| gpu-memory.json | [файл](../../../../../../immersive/webgpu/meta/research/2026-10-04/gpu-memory.json) | f1733fa62be0fdb47cbc20a8d7b6ac10444ac23fe597bc3ea451100d50c6046f |
| gpu-memory.ts | [файл](../../../../../../immersive/webgpu/meta/research/2026-10-04/gpu-memory.ts.txt) | 0809b145305ac13976a42b52e67f4fa24d73718ff82b662c4f90a753d2e14a43 |
| heap-after.json | [файл](../../../../../../immersive/browser/meta/research/2026-10-04/heap-after.json) | d6225b6c9c59c3b9d68e63f7fb0b184155e380ac6d939de11cbfd9404b1ae541 |
| heap-after.ts | [файл](../../../../../../immersive/browser/meta/research/2026-10-04/heap-after.ts.txt) | b05400e0b9ed37fff267dc4379840fce33d5da979e6d40e78ea9528454493036 |
| inspect.ts | [файл](../../../../../../immersive/devtool/meta/research/2026-10-04/inspect.ts.txt) | 797e9b06b62c191e85e40c9f26c78d2640dcfaaa14899944c18ec8ae79368491 |
| interaction.cpuprofile | [файл](../../../../../../immersive/devtool/meta/research/2026-10-04/interaction.cpuprofile) | a34115d314ad1ce83a68c912b777629173803139171aae86706a1ccb215a23ef |
| interaction.ts | [файл](../../../../../../immersive/devtool/meta/research/2026-10-04/interaction.ts.txt) | c398b3dd1a7417e54dfaa028709bf3684f4d9063adfac58b98c1db78bd5a6305 |
| investigation-start.json | [файл](../../../../../../immersive/browser/meta/research/2026-10-04/investigation-start.json) | 725a4ccd60f7393bbc153e4ff44813716898ea4ef2c1e7489c385c67154334ef |
| live.json | [файл](../../../../../../immersive/ui/component/view/code-editor/meta/research/2026-10-04/live.json) | a8cb0c6b7a6d5d204ad54e71e194af561c843363a627a44e7822a1d57f3d8c86 |
| live.ts | [файл](../../../../../../immersive/ui/component/view/code-editor/meta/research/2026-10-04/live.ts.txt) | 994a13ca1facbfb92f91e77ad2b6a32e6e11d880047388b636d68de88fe849c4 |
| memory-context.json | [файл](../../../../../../immersive/browser/meta/research/2026-10-04/memory-context.json) | 5c48f826f93fa7eea2535873af5646d1ee725e311392d511d2ab25bec5389b2b |
| memory-context.ts | [файл](../../../../../../immersive/browser/meta/research/2026-10-04/memory-context.ts.txt) | ace6fead05e72ce68bda2a357b64aac5e6f1f45c41d33ab64866e14ef3489b2d |
| renderer-instances.json | [файл](../../../../../../immersive/browser/meta/research/2026-10-04/renderer-instances.json) | 023cbe327a18cbe43858c05a7b4f3cc8296f8520631cff9e392e9f5afb3781b0 |
| renderer-instances.ts | [файл](../../../../../../immersive/browser/meta/research/2026-10-04/renderer-instances.ts.txt) | 99ef7964107732f96f7101a7ae7acc2c8d57a044d2012b385473b648b0152577 |
| renderer-memory-scene.json | [файл](../../../../../../immersive/webgpu/meta/research/2026-10-04/renderer-memory-scene.json) | 79293d243ec2c4aee7a37a603b1d3dfc2ded61f036def6c3851b8762f525f535 |
| renderer-memory-scene.ts | [файл](../../../../../../immersive/webgpu/meta/research/2026-10-04/renderer-memory-scene.ts.txt) | 5cdea50f55b33e8ab150476a04ee6f9f5dbddf61658b4938cf40f86c6328d915 |
| renderer-memory.json | [файл](../../../../../../immersive/webgpu/meta/research/2026-10-04/renderer-memory.json) | df6c98091345973be3a656adaeedb42ce64566d368e43ddaa6d27451ee6a5c94 |
| renderer-memory.ts | [файл](../../../../../../immersive/webgpu/meta/research/2026-10-04/renderer-memory.ts.txt) | 404a0ff5de33e19f137a93a331fc1f3f82eb3fab9be6bbb751292fdea7dea361 |
| retained.json | [файл](../../../../../../immersive/ui/component/view/code-editor/meta/research/2026-10-04/retained.json) | 0385f73e0712899a09a9be3d47ec5a83b62681ef582a09275730eede3f6b289f |
| retained.ts | [файл](../../../../../../immersive/ui/component/view/code-editor/meta/research/2026-10-04/retained.ts.txt) | 737ffade5a94fa7d5cedc639a80b7348bee9e5539dfe8d9855eb934438f2768f |
| text-cache-defaults.json | [файл](../../../../../../immersive/engine/meta/research/2026-10-04/text-cache-defaults.json) | 3177a202bed8b7715d341428270ebb2e9d93e9ed37c3a86d71931ad6051e8339 |
| text-cache-defaults.ts | [файл](../../../../../../immersive/engine/meta/research/2026-10-04/text-cache-defaults.ts.txt) | 05dd14387c78a840fd74a985d672b491b4356503d9a34287df216bb45d2f9abb |
| text-cache-usage.json | [файл](../../../../../../immersive/engine/meta/research/2026-10-04/text-cache-usage.json) | 7311699e956a0ea3eb9c457d5810345c14df48ef3c1ede8466a033f658bad05a |
| text-cache-usage.ts | [файл](../../../../../../immersive/engine/meta/research/2026-10-04/text-cache-usage.ts.txt) | 21ab52087311f7f2b00d9fdea396404690e93a1471c5ee1d4dba212bd3586192 |
| text-cache.json | [файл](../../../../../../immersive/engine/meta/research/2026-10-04/text-cache.json) | b28bd130de127d8b0f7633c967ce75a9e110c4c740e7846d1c9213ccdd851da0 |
| text-cache.ts | [файл](../../../../../../immersive/engine/meta/research/2026-10-04/text-cache.ts.txt) | a453ad4f99c2e76cf1ac01da9fa27de7f06543f44cd4aa1152e984a702348287 |

## App

`catalog-size.json`: ответ `/api/client` — 6 690 962 байта, из них документы
контрактов — 6 068 605, dependencyCases — 34 486. Навигационные узлы без этих
полей — 417 969 байт. Размер JSON не равен удерживаемому heap.
Общий каталог должен передавать маршруты, а содержание — раскрываться у выбранного
владельца. Подготовленная ревизия уже содержит собственные документы и должна
сохранять их привязку к ревизии; данные более нового графа не подмешиваются.

Скрытый журнал уже исправлен в `2f540e56`: App освобождает строки редактора,
сохраняя полный ответ и состояние окна. Избыточные уведомления Lazy от `meta`
исправлены в `3cd0220f`; фильтр вступает в силу после запуска соответствующего
родительского процесса. Эти правки не доказывают устранение всех причин 2,1 ГБ.

## Свидетельства пользователя

* [Мониторинг процессов](activity-monitor.png) — снимок 22:39:45. Показывает CPU процессов, не распределение памяти внутри вкладки.
* [Страница не отвечает](page-unresponsive.png) — снимок 22:41:35. Подтверждает зависание UI; причину устанавливают замеры, а не сам диалог Chrome.

Объём 2,1 ГБ сообщён пользователем. В последующем исследовании этот точный пик не был воспроизведён.

## Изменения App 5 октября

* [Результаты проверок](../2026-10-05/checks.json): 75 прошедших проверок, 2 условных пропуска, typecheck без ошибок.
* [Страница, Client, Protocol и журнал](../2026-10-05/app-tests-final.log).
* [HTTP выбранного узла](../2026-10-05/app-http-test.log).
* [Agent Bridge](../2026-10-05/app-bridge-tests.log).
* [Расчёт сокращения общего ответа](../2026-10-05/catalog-projection.json): около 91%, без утверждения такого же снижения памяти вкладки.

App больше не создаёт неиспользуемые Map всех узлов при инспекции и поиске цели.
Общий snapshot Inspector остаётся у Devtool; его ограничение описано у владельца.

## Проверка действующего приложения

* [Размер общего ответа после применения](../2026-10-05/live-catalog-size.json): 579 681 байт, все 669 узлов и 400 пакетов сохранены; документы не передаются. Прежний размер — 6 690 962 байта.
* [Ответ отдельного узла](../2026-10-05/live-node-content.json): HTTP 200, совпадают nodeId и graphDigest, контракт Output сохранён. [Методика чтения](../2026-10-05/app-node-content.ts.txt).
* [MCP-подтверждение Web и состояния страницы](../2026-10-05/live-application.json): новый host применён, ready/presented, диагностика пустая; после серверного перезапуска сохранены route, chat inspector и timeOrigin.
* [Контекст памяти после применения](../2026-10-05/live-memory-context.json). Во время подготовки Web контекст страницы сменился относительно исследования 4 октября: этот heap нельзя использовать как чистое сравнение эффекта правок. Принудительный GC в итоговой проверке не запускался.

Штатный перезапуск выполнен через Storybook MCP. До него адресный чат имел
состояние idle. Порт и состав Project восстановлены механизмом App. Первое
обращение inspect после перезапуска не знало старый viewId; перечисление
представлений через status восстановило регистрацию, следующая инспекция
успешна. Вкладка не перенаправлялась диагностическими скриптами.
