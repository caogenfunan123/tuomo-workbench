part of 'app.dart';

extension _WorkspaceEditor on _WorkspaceScreenState {
  Widget _writing(BuildContext context) => Column(children: <Widget>[
        if (widget.controller.editorStore.sessions.isNotEmpty) _sessionTabs(),
        Expanded(
            child: Row(children: <Widget>[
          SizedBox(
              width: 280,
              child: Column(children: <Widget>[
                Padding(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                    child: TextField(
                        decoration: const InputDecoration(
                            prefixIcon: Icon(Icons.search),
                            hintText: '搜索草稿',
                            border: OutlineInputBorder()),
                        onChanged: widget.controller.search)),
                Expanded(
                    child: ListView.builder(
                        itemCount: widget.controller.articles.length,
                        itemBuilder: (BuildContext context, int index) {
                          final Article article =
                              widget.controller.articles[index];
                          return ListTile(
                              title: Text(article.title.isEmpty
                                  ? '未命名文章'
                                  : article.title),
                              subtitle:
                                  Text('revision ${article.localRevision}'),
                              selected: session?.article.id == article.id,
                              onTap: () async {
                                if (session?.isDirty ?? false) {
                                  await widget.controller.save(session!);
                                }
                                session = await widget.controller
                                    .openArticle(article.id);
                                _setState(() {});
                              },
                              trailing: IconButton(
                                  icon: const Icon(Icons.delete_outline),
                                  onPressed: () async {
                                    await widget.controller.delete(article.id);
                                    if (mounted &&
                                        session?.article.id == article.id) {
                                      _setState(() => session = null);
                                    }
                                  }));
                        }))
              ])),
          const VerticalDivider(width: 1),
          Expanded(child: _editor()),
        ])),
      ]);

  Future<void> _showTrash() async {
    await widget.controller.refreshTrash();
    if (!mounted) return;
    await showDialog<void>(
        context: context,
        builder: (BuildContext dialogContext) => StatefulBuilder(
              builder: (BuildContext context,
                      void Function(void Function()) setDialogState) =>
                  AlertDialog(
                title: const Text('回收站'),
                content: SizedBox(
                    width: 520,
                    height: 360,
                    child: widget.controller.trash.isEmpty
                        ? const Center(child: Text('回收站为空'))
                        : ListView.builder(
                            itemCount: widget.controller.trash.length,
                            itemBuilder: (BuildContext context, int index) {
                              final Article article =
                                  widget.controller.trash[index];
                              return ListTile(
                                  title: Text(article.title.isEmpty
                                      ? '未命名文章'
                                      : article.title),
                                  subtitle: Text(
                                      article.updatedAt.toLocal().toString()),
                                  trailing: Wrap(spacing: 4, children: <Widget>[
                                    IconButton(
                                        tooltip: '恢复',
                                        icon: const Icon(Icons.restore),
                                        onPressed: () async {
                                          await widget.controller
                                              .restoreTrash(article.id);
                                          setDialogState(() {});
                                        }),
                                    IconButton(
                                        tooltip: '永久删除',
                                        icon: const Icon(Icons.delete_forever),
                                        onPressed: () async {
                                          if (!await _confirmPermanentDelete(
                                              '永久删除后无法恢复这篇文章，继续吗？')) {
                                            return;
                                          }
                                          await widget.controller
                                              .deleteTrash(article.id);
                                          setDialogState(() {});
                                        }),
                                  ]));
                            })),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.of(dialogContext).pop(),
                      child: const Text('关闭')),
                ],
              ),
            ));
  }

  Future<void> _showSnapshots() async {
    final DocumentSession? current = session;
    if (current == null) return;
    List<Article> snapshots =
        await widget.controller.listSnapshots(current.article.id);
    if (!mounted) return;
    await showDialog<void>(
        context: context,
        builder: (BuildContext dialogContext) => StatefulBuilder(
              builder: (BuildContext context,
                      void Function(void Function()) setDialogState) =>
                  AlertDialog(
                title: const Text('版本快照'),
                content: SizedBox(
                    width: 560,
                    height: 360,
                    child: snapshots.isEmpty
                        ? const Center(child: Text('暂无快照'))
                        : ListView.builder(
                            itemCount: snapshots.length,
                            itemBuilder: (BuildContext context, int index) {
                              final Article snapshot = snapshots[index];
                              return ListTile(
                                  title: Text(
                                      'revision ${snapshot.localRevision}'),
                                  subtitle: Text(
                                      snapshot.updatedAt.toLocal().toString()),
                                  trailing: Wrap(spacing: 4, children: <Widget>[
                                    IconButton(
                                        tooltip: '恢复此版本',
                                        icon: const Icon(Icons.restore_page),
                                        onPressed: () async {
                                          await widget.controller
                                              .restoreSnapshot(
                                                  current.article.id,
                                                  snapshot.localRevision);
                                          session = widget
                                              .controller.editorStore.active;
                                          snapshots = await widget.controller
                                              .listSnapshots(
                                                  current.article.id);
                                          setDialogState(() {});
                                          if (mounted) _setState(() {});
                                        }),
                                    IconButton(
                                        tooltip: '删除快照',
                                        icon: const Icon(Icons.delete_outline),
                                        onPressed: () async {
                                          if (!await _confirmPermanentDelete(
                                              '删除此版本快照后无法恢复，继续吗？')) {
                                            return;
                                          }
                                          await widget.controller
                                              .deleteSnapshot(
                                                  current.article.id,
                                                  snapshot.localRevision);
                                          snapshots = await widget.controller
                                              .listSnapshots(
                                                  current.article.id);
                                          setDialogState(() {});
                                        }),
                                  ]));
                            })),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.of(dialogContext).pop(),
                      child: const Text('关闭')),
                ],
              ),
            ));
  }

  Future<bool> _confirmPermanentDelete(String message) async {
    final bool? confirmed = await showDialog<bool>(
        context: context,
        builder: (BuildContext dialogContext) => AlertDialog(
              title: const Text('确认永久删除'),
              content: Text(message),
              actions: <Widget>[
                TextButton(
                    onPressed: () => Navigator.of(dialogContext).pop(false),
                    child: const Text('取消')),
                FilledButton(
                    onPressed: () => Navigator.of(dialogContext).pop(true),
                    child: const Text('永久删除')),
              ],
            ));
    return confirmed == true;
  }

  Widget _sessionTabs() {
    final List<DocumentSession> sessions =
        widget.controller.editorStore.sessions.toList();
    return SizedBox(
        height: 48,
        child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            children: sessions
                .map((DocumentSession value) => Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                        label: Text(value.article.title.isEmpty
                            ? '未命名文章'
                            : value.article.title),
                        selected: session?.article.id == value.article.id,
                        onSelected: (_) => _setState(() {
                              session = value;
                              widget.controller.editorStore
                                  .switchTo(value.article.id);
                            }))))
                .toList()));
  }

  Widget _editor() {
    final DocumentSession? currentSession = session;
    if (currentSession == null) {
      return const Center(child: Text('选择或新建一篇文章'));
    }
    return EditorPane(
        session: currentSession,
        onSave: () => widget.controller.save(currentSession),
        onExportFormat: (document_export.DocumentExportFormat format) =>
            widget.controller.exportDocument(currentSession, format),
        onPreview: () =>
            widget.controller.previewMarkdown(context, currentSession),
        editorFontSize: widget.controller.preferences.editorFontSize,
        typewriterMode: widget.controller.preferences.typewriterMode);
  }
}
