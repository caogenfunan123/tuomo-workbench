part of 'app.dart';

const List<String> _sectionTitles = <String>[
  '拓墨',
  '写作',
  '草稿',
  '发布中心',
  '站点管理',
  'AI 工作台',
  '图床',
  '辅助工具',
  '设置与安全',
  '全部功能',
];

extension _WorkspaceLayout on _WorkspaceScreenState {
  Future<void> _createQuickNote() async {
    if (widget
        .controller.platformServices.info.capabilities.supportsQuickNote) {
      try {
        await widget.controller.platformServices.quickNote.openQuickNote();
      } on PlatformCapabilityException {
        // A missing native plugin falls back to the shared editor flow.
      }
    }
    session = await widget.controller.createArticle();
    if (mounted) _setState(() => section = 1);
  }

  bool _isCompact(BuildContext context) =>
      MediaQuery.sizeOf(context).width < 720;

  Widget _content(BuildContext context) => section == 0
      ? _home()
      : section == 1 || section == 2
          ? _writing(context)
          : section == 8
              ? _settings()
              : section == 7
                  ? _tools()
                  : section == 9
                      ? _featureCatalog()
                      : section == 3
                          ? _publishCenter()
                          : section == 4
                              ? _siteManager()
                              : section == 5
                                  ? _aiWorkbench()
                                  : section == 6
                                      ? _imageHostCenter()
                                      : _home();

  Widget _wideBody(BuildContext context) => Row(children: <Widget>[
        if (widget.controller.preferences.sidebarVisible) ...<Widget>[
          _wideNavigation(),
          const VerticalDivider(width: 1),
        ],
        Expanded(child: _content(context)),
      ]);

  Widget _wideNavigation() {
    const List<(int, IconData, String)> allEntries = <(int, IconData, String)>[
      (0, Icons.home_outlined, '首页'),
      (1, Icons.edit, '写作'),
      (2, Icons.drafts_outlined, '草稿'),
      (3, Icons.cloud_upload, '发布'),
      (4, Icons.language, '站点'),
      (5, Icons.auto_awesome, 'AI'),
      (6, Icons.image_outlined, '图床'),
      (7, Icons.build_outlined, '工具'),
      (8, Icons.settings, '设置'),
      (9, Icons.apps, '全部功能'),
    ];
    final List<(int, IconData, String)> entries =
        widget.controller.preferences.mode == WorkspaceMode.simple
            ? allEntries
                .where(((int, IconData, String) entry) =>
                    <int>{0, 1, 2, 3, 8}.contains(entry.$1))
                .toList()
            : allEntries;
    final bool pinned = widget.controller.preferences.sidebarPinned;
    return SizedBox(
        width: pinned ? 104 : 64,
        child: ListView.builder(
            padding: const EdgeInsets.symmetric(vertical: 8),
            itemCount: entries.length,
            itemBuilder: (BuildContext context, int index) {
              final (int target, IconData icon, String label) = entries[index];
              return Tooltip(
                  message: label,
                  child: ListTile(
                      dense: true,
                      selected: section == target,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                      leading: Icon(icon),
                      title: pinned
                          ? Text(label, overflow: TextOverflow.ellipsis)
                          : null,
                      onTap: () => _setState(() => section = target)));
            }));
  }

  Widget _compactBody(BuildContext context) => _content(context);

  Widget _compactNavigation() => NavigationBar(
        selectedIndex: <int>[0, 1, 3, 4, 8].indexOf(section).clamp(0, 4),
        onDestinationSelected: (int value) =>
            _setState(() => section = <int>[0, 1, 3, 4, 8][value]),
        destinations: const <NavigationDestination>[
          NavigationDestination(icon: Icon(Icons.home_outlined), label: '首页'),
          NavigationDestination(icon: Icon(Icons.edit), label: '写作'),
          NavigationDestination(icon: Icon(Icons.cloud_upload), label: '发布'),
          NavigationDestination(icon: Icon(Icons.language), label: '站点'),
          NavigationDestination(icon: Icon(Icons.settings), label: '设置'),
        ],
      );

  String _sectionTitle() => _sectionTitles[section];

  Widget _settings() {
    final WorkspacePreferences value = widget.controller.preferences;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: <Widget>[
        Text('设置与安全', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 8),
        const Text('偏好只保存显示和编辑行为；凭据仍由平台安全存储管理。'),
        const SizedBox(height: 16),
        Card(
          child: Column(children: <Widget>[
            SwitchListTile(
              title: const Text('标准模式'),
              subtitle: const Text('显示发布、站点、AI、图床和辅助工具入口'),
              value: value.mode == WorkspaceMode.standard,
              onChanged: (bool enabled) => unawaited(widget.controller
                  .updatePreferences(value.copyWith(
                      mode: enabled
                          ? WorkspaceMode.standard
                          : WorkspaceMode.simple))),
            ),
            SwitchListTile(
              title: const Text('显示侧边栏'),
              subtitle: const Text('桌面宽屏下显示主导航栏'),
              value: value.sidebarVisible,
              onChanged: (bool enabled) => unawaited(widget.controller
                  .updatePreferences(value.copyWith(sidebarVisible: enabled))),
            ),
            SwitchListTile(
              title: const Text('固定侧边栏'),
              subtitle: const Text('关闭时保留窄图标栏，便于快速切换'),
              value: value.sidebarPinned,
              onChanged: value.sidebarVisible
                  ? (bool enabled) => unawaited(widget.controller
                      .updatePreferences(
                          value.copyWith(sidebarPinned: enabled)))
                  : null,
            ),
            SwitchListTile(
              title: const Text('专注模式'),
              subtitle: const Text('隐藏导航，只保留当前工作区'),
              value: value.focusMode,
              onChanged: (bool enabled) => unawaited(widget.controller
                  .updatePreferences(value.copyWith(focusMode: enabled))),
            ),
            SwitchListTile(
              title: const Text('打字机滚动'),
              subtitle: const Text('输入时将当前行保持在编辑器中部'),
              value: value.typewriterMode,
              onChanged: (bool enabled) => unawaited(widget.controller
                  .updatePreferences(value.copyWith(typewriterMode: enabled))),
            ),
            SwitchListTile(
              title: const Text('护眼模式'),
              subtitle: const Text('强制使用深色主题，适合夜间写作'),
              value: value.nightMode,
              onChanged: (bool enabled) => unawaited(widget.controller
                  .updatePreferences(value.copyWith(nightMode: enabled))),
            ),
            ListTile(
              title: const Text('主题'),
              trailing: DropdownButton<WorkspaceTheme>(
                value: value.theme,
                onChanged: (WorkspaceTheme? theme) {
                  if (theme == null) return;
                  unawaited(widget.controller
                      .updatePreferences(value.copyWith(theme: theme)));
                },
                items: const <DropdownMenuItem<WorkspaceTheme>>[
                  DropdownMenuItem(
                      value: WorkspaceTheme.system, child: Text('跟随系统')),
                  DropdownMenuItem(
                      value: WorkspaceTheme.light, child: Text('浅色')),
                  DropdownMenuItem(
                      value: WorkspaceTheme.dark, child: Text('深色')),
                ],
              ),
            ),
            ListTile(
              title: const Text('编辑器字号'),
              subtitle: Slider(
                value: value.editorFontSize,
                min: 12,
                max: 32,
                divisions: 20,
                label: value.editorFontSize.toStringAsFixed(0),
                onChanged: (double size) => unawaited(widget.controller
                    .updatePreferences(value.copyWith(editorFontSize: size))),
              ),
            ),
          ]),
        ),
        const SizedBox(height: 16),
        Card(
          child: ListTile(
            leading: const Icon(Icons.lock_outline),
            title: const Text('秘密存储'),
            subtitle: Text(widget.controller.platformServices.info.capabilities
                    .supportsNativePaths
                ? '使用平台安全存储适配器，不写入普通 JSON'
                : '使用当前平台的安全存储适配器'),
          ),
        ),
      ],
    );
  }

  Widget _tools() {
    final DocumentSession? current = session;
    final String markdown = current?.article.body ?? '';
    final content_tools.MarkdownStats stats =
        content_tools.markdownStats(markdown);
    final List<content_tools.TableOfContentsEntry> toc =
        content_tools.tableOfContents(markdown);
    return ListView(
      padding: const EdgeInsets.all(24),
      children: <Widget>[
        Text('辅助工具', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 8),
        const Text('当前文章的本地工具会直接修改编辑会话，并沿用同一套自动保存与恢复机制。'),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: current == null
                ? const Text('请先在写作页打开一篇文章。')
                : Wrap(
                    spacing: 18,
                    runSpacing: 10,
                    children: <Widget>[
                      _toolStat('字数', '${stats.words}'),
                      _toolStat('字符', '${stats.characters}'),
                      _toolStat('行数', '${stats.lines}'),
                      _toolStat('标题', '${stats.headings}'),
                      _toolStat('链接', '${stats.links}'),
                      _toolStat('代码块', '${stats.codeBlocks}'),
                    ],
                  ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                FilledButton.icon(
                    onPressed: current == null ? null : _formatCurrent,
                    icon: const Icon(Icons.auto_fix_high),
                    label: const Text('格式化当前文章')),
                OutlinedButton.icon(
                    onPressed: current == null ? null : _findReplaceCurrent,
                    icon: const Icon(Icons.find_replace),
                    label: const Text('查找替换')),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('目录', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                if (toc.isEmpty) const Text('当前文章还没有 Markdown 标题。'),
                ...toc.map((content_tools.TableOfContentsEntry entry) =>
                    Padding(
                        padding: EdgeInsets.only(left: (entry.level - 1) * 14),
                        child: Text('${entry.anchor} · ${entry.text}'))),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                OutlinedButton.icon(
                    onPressed: _refreshRss,
                    icon: const Icon(Icons.rss_feed),
                    label: const Text('刷新 RSS')),
                OutlinedButton.icon(
                    onPressed: current == null ? null : _checkLinksCurrent,
                    icon: const Icon(Icons.link),
                    label: const Text('检查链接')),
                OutlinedButton.icon(
                    onPressed: current == null ? null : _uploadImage,
                    icon: const Icon(Icons.cloud_upload_outlined),
                    label: const Text('上传图片并插入')),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _toolStat(String label, String value) => SizedBox(
      width: 86,
      child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(label, style: Theme.of(context).textTheme.labelMedium),
            Text(value, style: Theme.of(context).textTheme.titleLarge),
          ]));

  Future<void> _refreshRss() async {
    final TextEditingController input = TextEditingController();
    final String? url = await showDialog<String>(
        context: context,
        builder: (BuildContext dialogContext) => AlertDialog(
              title: const Text('刷新 RSS'),
              content: TextField(
                  controller: input,
                  keyboardType: TextInputType.url,
                  decoration: const InputDecoration(
                      labelText: '订阅地址',
                      hintText: 'https://example.com/feed.xml')),
              actions: <Widget>[
                TextButton(
                    onPressed: () => Navigator.pop(dialogContext),
                    child: const Text('取消')),
                FilledButton(
                    onPressed: () => Navigator.pop(dialogContext, input.text),
                    child: const Text('刷新')),
              ],
            ));
    input.dispose();
    if (url == null || url.trim().isEmpty) return;
    try {
      final List<RssToolItem> items = await widget
          .controller.platformServices.remoteTools
          .refreshRss(url.trim());
      if (!mounted) return;
      await showDialog<void>(
          context: context,
          builder: (BuildContext dialogContext) => AlertDialog(
                title: const Text('RSS 条目'),
                content: SizedBox(
                    width: 560,
                    height: 360,
                    child: items.isEmpty
                        ? const Center(child: Text('没有可显示的条目'))
                        : ListView(
                            children: items
                                .map((RssToolItem item) => ListTile(
                                    title: Text(item.title),
                                    subtitle: Text(
                                        item.link ?? item.publishedAt ?? '')))
                                .toList())),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(dialogContext),
                      child: const Text('关闭'))
                ],
              ));
    } catch (error) {
      _showToolError(error);
    }
  }

  Future<void> _checkLinksCurrent() async {
    final DocumentSession? current = session;
    if (current == null) return;
    try {
      final LinkToolReport report = await widget
          .controller.platformServices.remoteTools
          .checkLinks(current.article.body);
      if (!mounted) return;
      final String text = report.results.isEmpty
          ? '当前文章没有 HTTP 链接。'
          : report.results
              .map((LinkToolResult item) =>
                  '${item.ok ? '✓' : '✗'} ${item.url}${item.status == null ? '' : ' · ${item.status}'}${item.error == null ? '' : ' · ${item.error}'}')
              .join('\n');
      await showDialog<void>(
          context: context,
          builder: (BuildContext dialogContext) => AlertDialog(
                title: Text(report.cancelled ? '链接检查（已取消）' : '链接检查'),
                content: SingleChildScrollView(child: SelectableText(text)),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(dialogContext),
                      child: const Text('关闭'))
                ],
              ));
    } catch (error) {
      _showToolError(error);
    }
  }

  Future<void> _uploadImage() async {
    final DocumentSession? current = session;
    if (current == null) return;
    try {
      final PickedFile? image =
          await widget.controller.platformServices.filePicker.pickImage();
      if (image == null) return;
      final TextEditingController site = TextEditingController(text: 'active');
      final String? siteId = await showDialog<String>(
          context: context,
          builder: (BuildContext dialogContext) => AlertDialog(
                title: const Text('上传到图床'),
                content: TextField(
                    controller: site,
                    decoration: const InputDecoration(labelText: '静态站点 ID')),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(dialogContext),
                      child: const Text('取消')),
                  FilledButton(
                      onPressed: () => Navigator.pop(dialogContext, site.text),
                      child: const Text('上传')),
                ],
              ));
      site.dispose();
      if (siteId == null || siteId.trim().isEmpty) return;
      final String mimeType = image.name.toLowerCase().endsWith('.jpg') ||
              image.name.toLowerCase().endsWith('.jpeg')
          ? 'image/jpeg'
          : image.name.toLowerCase().endsWith('.webp')
              ? 'image/webp'
              : 'image/png';
      final ImageToolResult result = await widget
          .controller.platformServices.remoteTools
          .uploadImage(siteId: siteId.trim(), image: image, mimeType: mimeType);
      if (!result.ok || result.markdownUrl == null) {
        _showToolError(result.error ?? '图床上传失败');
        return;
      }
      final String separator =
          current.article.body.isEmpty || current.article.body.endsWith('\n')
              ? ''
              : '\n';
      current.edit(
          body:
              '${current.article.body}$separator![](${result.markdownUrl})\n');
      await widget.controller.save(current);
      if (mounted) _setState(() {});
    } catch (error) {
      _showToolError(error);
    }
  }

  void _showToolError(Object error) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text('工具不可用：$error')));
  }

  Future<void> _formatCurrent() async {
    final DocumentSession? current = session;
    if (current == null) return;
    current.edit(body: content_tools.formatMarkdown(current.article.body));
    try {
      await widget.controller.save(current);
    } catch (_) {
      // The editor keeps the dirty/failed state and exposes retry through Save.
    }
    if (mounted) _setState(() {});
  }

  Future<void> _findReplaceCurrent() async {
    final DocumentSession? current = session;
    if (current == null) return;
    final TextEditingController search = TextEditingController();
    final TextEditingController replacement = TextEditingController();
    final bool apply = await showDialog<bool>(
          context: context,
          builder: (BuildContext dialogContext) => AlertDialog(
            title: const Text('查找替换'),
            content: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
              TextField(
                  controller: search,
                  decoration: const InputDecoration(labelText: '查找内容')),
              TextField(
                  controller: replacement,
                  decoration: const InputDecoration(labelText: '替换为')),
            ]),
            actions: <Widget>[
              TextButton(
                  onPressed: () => Navigator.pop(dialogContext, false),
                  child: const Text('取消')),
              FilledButton(
                  onPressed: () => Navigator.pop(dialogContext, true),
                  child: const Text('替换')),
            ],
          ),
        ) ??
        false;
    final String query = search.text;
    final String value = replacement.text;
    search.dispose();
    replacement.dispose();
    if (!apply || query.isEmpty) return;
    current.edit(
        body: content_tools.findAndReplace(current.article.body, query, value));
    try {
      await widget.controller.save(current);
    } catch (_) {
      // The editor keeps the dirty/failed state and exposes retry through Save.
    }
    if (mounted) _setState(() {});
  }
}
