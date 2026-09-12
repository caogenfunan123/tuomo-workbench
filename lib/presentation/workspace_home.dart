part of 'app.dart';

extension _WorkspaceHome on _WorkspaceScreenState {
  Widget _home() => ListView(
        padding: const EdgeInsets.all(32),
        children: <Widget>[
          Text('离线优先写作工作台', style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 8),
          const Text('本地文章、站点发布、同步和 AI 工具均通过共享 application 层编排。'),
          const SizedBox(height: 8),
          Text(
              '当前平台：${widget.controller.platformServices.info.platform.name} · Web/原生能力按 adapter 注入'),
          if (widget.controller.initializationWarning != null)
            Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Card(
                    color: Theme.of(context).colorScheme.errorContainer,
                    child: ListTile(
                        leading: const Icon(Icons.warning_amber),
                        title: const Text('已启用安全降级'),
                        subtitle:
                            Text(widget.controller.initializationWarning!)))),
          const SizedBox(height: 24),
          Wrap(spacing: 12, runSpacing: 12, children: <Widget>[
            _statCard('本地草稿', '${widget.controller.articles.length}'),
            _statCard(
                '打开会话', '${widget.controller.editorStore.sessions.length}'),
            _statCard(
                '当前搜索',
                widget.controller.searchText.isEmpty
                    ? '全部'
                    : widget.controller.searchText),
          ]),
          const SizedBox(height: 24),
          FilledButton.icon(
              onPressed: _createQuickNote,
              icon: const Icon(Icons.edit),
              label: const Text('开始写作')),
          if (widget.controller.recentArticles.isNotEmpty) ...<Widget>[
            const SizedBox(height: 28),
            Text('最近编辑', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Card(
              child: Column(
                children: widget.controller.recentArticles
                    .map((Article article) => ListTile(
                          leading: const Icon(Icons.history),
                          title: Text(
                              article.title.isEmpty ? '未命名文章' : article.title),
                          subtitle:
                              Text(article.updatedAt.toLocal().toString()),
                          onTap: () async {
                            session =
                                await widget.controller.openArticle(article.id);
                            if (mounted) _setState(() => section = 1);
                          },
                        ))
                    .toList(),
              ),
            ),
          ],
        ],
      );

  Widget _statCard(String label, String value) => Card(
        child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(label),
                  const SizedBox(height: 6),
                  Text(value, style: Theme.of(context).textTheme.titleLarge),
                ])),
      );
}
