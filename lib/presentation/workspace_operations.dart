part of 'app.dart';

extension _WorkspaceOperations on _WorkspaceScreenState {
  Widget _featureCatalog() {
    final List<Map<String, Object?>> features = <Map<String, Object?>>[
      <String, Object?>{
        'id': 'W01-W09',
        'name': '本地写作与数据',
        'detail': '文章、草稿、快照、回收站、导入导出、模板和搜索',
        'target': 1
      },
      <String, Object?>{
        'id': 'P01-P05',
        'name': '静态发布',
        'detail': '框架渲染、远程文章、预览/确认和冲突保护',
        'target': 3
      },
      <String, Object?>{
        'id': 'P06-P10',
        'name': '站点与 CMS',
        'detail': 'CMS、健康检查、一键建站和构建触发',
        'target': 4
      },
      <String, Object?>{
        'id': 'A01-A08',
        'name': 'AI 与自动化',
        'detail': '快速写作、Agent、工具权限、Skill、MCP 和审计',
        'target': 5
      },
      <String, Object?>{
        'id': 'U01-U04',
        'name': '辅助工具',
        'detail': 'RSS、链接、图床、批量上传、编码修复和缓存清理',
        'target': 7
      },
      <String, Object?>{
        'id': 'U05',
        'name': '外观与导航',
        'detail': '简易/标准模式、主题、侧栏和全部功能入口',
        'target': 8
      },
      <String, Object?>{
        'id': 'S01-S07',
        'name': '同步与安全',
        'detail': 'WebDAV、Git、P2P、备份、加密、迁移和审计；服务端端口已实现',
        'target': null
      },
      <String, Object?>{
        'id': 'W10',
        'name': '平台能力',
        'detail': 'Web/移动/桌面文件、窗口、速记和安全预览 adapter',
        'target': 8
      },
    ];
    return ListView(padding: const EdgeInsets.all(24), children: <Widget>[
      Text('全部功能', style: Theme.of(context).textTheme.headlineSmall),
      const SizedBox(height: 8),
      const Text('隐藏入口只影响可见性，不改变权限或底层数据；点击已接入项可直接进入对应工作区。'),
      const SizedBox(height: 16),
      ...features.map((Map<String, Object?> feature) => Card(
            child: ListTile(
                leading: CircleAvatar(
                    child: Text((feature['id']! as String).split('-').first)),
                title: Text(feature['name']! as String),
                subtitle: Text('${feature['id']} · ${feature['detail']}'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () {
                  final int? target = feature['target'] as int?;
                  if (target != null) {
                    _setState(() => section = target);
                  } else {
                    _showCapabilityDetails(feature);
                  }
                }),
          )),
    ]);
  }

  Future<void> _showCapabilityDetails(Map<String, Object?> feature) =>
      showDialog<void>(
          context: context,
          builder: (BuildContext dialogContext) => AlertDialog(
                title: Text(feature['name']! as String),
                content: Text(
                    '${feature['id']}\n\n${feature['detail']}\n\n当前平台未提供独立同步面板；Node application 层和端口仍可由同源宿主调用。'),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(dialogContext),
                      child: const Text('关闭')),
                ],
              ));

  Widget _publishCenter() {
    final DocumentSession? current = session;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: <Widget>[
        Text('发布中心', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 8),
        const Text('先生成远端预览，再确认发布到已配置的静态站点。当前文章仍保存在本地编辑会话。'),
        const SizedBox(height: 16),
        Card(
          child: ListTile(
            leading: const Icon(Icons.article_outlined),
            title: Text(current?.article.title.isEmpty ?? true
                ? '尚未打开文章'
                : current!.article.title),
            subtitle: Text(current == null
                ? '请先在写作页打开文章'
                : '本地 revision ${current.article.localRevision}'),
            trailing: Wrap(spacing: 8, children: <Widget>[
              OutlinedButton(
                  onPressed: current == null
                      ? null
                      : () =>
                          widget.controller.previewMarkdown(context, current),
                  child: const Text('本地预览')),
              OutlinedButton(
                  onPressed: current == null
                      ? null
                      : () => widget.controller.exportMarkdown(current),
                  child: const Text('导出 Markdown')),
            ]),
          ),
        ),
        const SizedBox(height: 12),
        FutureBuilder<List<WorkspaceSite>>(
          future: widget.controller.platformServices.workspace.listSites(),
          builder: (BuildContext context,
              AsyncSnapshot<List<WorkspaceSite>> snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Card(
                  child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Center(child: CircularProgressIndicator())));
            }
            if (snapshot.hasError) {
              return Card(
                  child: ListTile(
                      leading: const Icon(Icons.cloud_off),
                      title: const Text('远程站点服务不可用'),
                      subtitle: Text('${snapshot.error}')));
            }
            final List<WorkspaceSite> sites =
                (snapshot.data ?? <WorkspaceSite>[])
                    .where((WorkspaceSite site) => site.kind == 'static')
                    .toList();
            if (sites.isEmpty) {
              return const Card(
                  child: ListTile(
                      leading: Icon(Icons.info_outline),
                      title: Text('没有可发布的静态站点'),
                      subtitle: Text('请先在“站点管理”中完成一键建站或配置站点。')));
            }
            return Card(
                child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text('静态站点',
                              style: Theme.of(context).textTheme.titleMedium),
                          const SizedBox(height: 8),
                          ...sites.map((WorkspaceSite site) => ListTile(
                              contentPadding: EdgeInsets.zero,
                              leading: Icon(site.active
                                  ? Icons.radio_button_checked
                                  : Icons.radio_button_unchecked),
                              title: Text(site.name),
                              subtitle: Text(
                                  '${site.id}${site.url == null ? '' : ' · ${site.url}'}'),
                              trailing: site.active
                                  ? const Chip(label: Text('默认'))
                                  : null)),
                          const Divider(),
                          Wrap(spacing: 8, runSpacing: 8, children: <Widget>[
                            OutlinedButton.icon(
                                onPressed: current == null
                                    ? null
                                    : () =>
                                        _publishCurrent(current, sites, false),
                                icon: const Icon(Icons.preview_outlined),
                                label: const Text('生成远端预览')),
                            FilledButton.icon(
                                onPressed: current == null
                                    ? null
                                    : () =>
                                        _publishCurrent(current, sites, true),
                                icon: const Icon(Icons.cloud_upload),
                                label: const Text('确认发布')),
                          ])
                        ])));
          },
        ),
      ],
    );
  }

  Future<void> _publishCurrent(
      DocumentSession current, List<WorkspaceSite> sites, bool confirm) async {
    try {
      final WorkspaceOperationResult result =
          await widget.controller.platformServices.workspace.publishArticle(
              article: current.article,
              siteIds: sites.map((WorkspaceSite site) => site.id).toList(),
              confirm: confirm);
      if (!mounted) return;
      final String details = result.data == null
          ? ''
          : '\n\n${const JsonEncoder.withIndent('  ').convert(result.data)}';
      await showDialog<void>(
          context: context,
          builder: (BuildContext dialogContext) => AlertDialog(
                title: Text(confirm ? '发布结果' : '远端预览'),
                content: SingleChildScrollView(
                    child: SelectableText(
                        '${result.ok ? '已完成' : '失败'}${result.message == null ? '' : '\n${result.message}'}$details')),
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

  Widget _siteManager() => ListView(
        padding: const EdgeInsets.all(24),
        children: <Widget>[
          Row(children: <Widget>[
            Expanded(
                child: Text('站点管理',
                    style: Theme.of(context).textTheme.headlineSmall)),
            FilledButton.icon(
                onPressed: _provisionSite,
                icon: const Icon(Icons.add_business),
                label: const Text('一键建站'))
          ]),
          const SizedBox(height: 8),
          const Text(
              '站点配置由 Node application/use case 管理；凭据只通过运行时 SecretRef 注入，不写入 Flutter 工作区。'),
          const SizedBox(height: 16),
          FutureBuilder<List<WorkspaceSite>>(
              future: widget.controller.platformServices.workspace.listSites(),
              builder: (BuildContext context,
                  AsyncSnapshot<List<WorkspaceSite>> snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return Card(
                      child: ListTile(
                          leading: const Icon(Icons.cloud_off),
                          title: const Text('无法读取站点注册表'),
                          subtitle: Text('${snapshot.error}')));
                }
                final List<WorkspaceSite> sites =
                    snapshot.data ?? <WorkspaceSite>[];
                if (sites.isEmpty) {
                  return const Card(
                      child: ListTile(
                          leading: Icon(Icons.language),
                          title: Text('还没有站点'),
                          subtitle: Text('点击“一键建站”创建 GitHub/GitLab 静态站点。')));
                }
                return Column(
                    children: sites
                        .map((WorkspaceSite site) => Card(
                              child: ListTile(
                                leading: Icon(site.kind == 'static'
                                    ? Icons.language
                                    : Icons.storage),
                                title: Text(site.name),
                                subtitle: Text(
                                    '${site.kind} · ${site.id}${site.url == null ? '' : '\n${site.url}'}'),
                                isThreeLine: site.url != null,
                                trailing: site.kind == 'static'
                                    ? OutlinedButton(
                                        onPressed: () => _buildSite(site),
                                        child: const Text('触发构建'))
                                    : null,
                              ),
                            ))
                        .toList());
              })
        ],
      );

  Future<void> _buildSite(WorkspaceSite site) async {
    try {
      final WorkspaceOperationResult result =
          await widget.controller.platformServices.workspace.buildSite(site.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(result.ok ? '已触发 ${site.name} 的构建' : '构建触发失败')));
    } catch (error) {
      _showToolError(error);
    }
  }

  Future<void> _provisionSite() async {
    final TextEditingController owner = TextEditingController();
    final TextEditingController repository = TextEditingController();
    final TextEditingController welcome = TextEditingController(
        text: '# Welcome\n\nThis site was provisioned by Tuomo.');
    String provider = 'github';
    String framework = 'hugo';
    String mode = 'pages';
    final Map<String, String>? input = await showDialog<Map<String, String>>(
        context: context,
        builder: (BuildContext dialogContext) => StatefulBuilder(
            builder: (BuildContext context,
                    void Function(void Function()) setDialogState) =>
                AlertDialog(
                  title: const Text('一键建站'),
                  content: SingleChildScrollView(
                      child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: <Widget>[
                        DropdownButtonFormField<String>(
                            initialValue: provider,
                            decoration:
                                const InputDecoration(labelText: 'Git 提供方'),
                            items: const <DropdownMenuItem<String>>[
                              DropdownMenuItem(
                                  value: 'github', child: Text('GitHub')),
                              DropdownMenuItem(
                                  value: 'gitlab', child: Text('GitLab')),
                            ],
                            onChanged: (String? value) => setDialogState(
                                () => provider = value ?? provider)),
                        TextField(
                            controller: owner,
                            decoration: const InputDecoration(
                                labelText: 'Owner / Namespace')),
                        TextField(
                            controller: repository,
                            decoration:
                                const InputDecoration(labelText: 'Repository')),
                        DropdownButtonFormField<String>(
                            initialValue: framework,
                            decoration: const InputDecoration(labelText: '框架'),
                            items: const <String>[
                              'hugo',
                              'hexo',
                              'jekyll',
                              'astro',
                              '11ty'
                            ]
                                .map((String value) => DropdownMenuItem<String>(
                                    value: value, child: Text(value)))
                                .toList(),
                            onChanged: (String? value) => setDialogState(
                                () => framework = value ?? framework)),
                        DropdownButtonFormField<String>(
                            initialValue: mode,
                            decoration:
                                const InputDecoration(labelText: '部署模式'),
                            items: const <DropdownMenuItem<String>>[
                              DropdownMenuItem(
                                  value: 'pages', child: Text('Pages')),
                              DropdownMenuItem(
                                  value: 'cloudflare',
                                  child: Text('Cloudflare')),
                            ],
                            onChanged: (String? value) =>
                                setDialogState(() => mode = value ?? mode)),
                        TextField(
                            controller: welcome,
                            maxLines: 4,
                            decoration: const InputDecoration(
                                labelText: '欢迎文章 Markdown')),
                      ])),
                  actions: <Widget>[
                    TextButton(
                        onPressed: () => Navigator.pop(dialogContext),
                        child: const Text('取消')),
                    FilledButton(
                        onPressed: () =>
                            Navigator.pop(dialogContext, <String, String>{
                              'provider': provider,
                              'owner': owner.text.trim(),
                              'repository': repository.text.trim(),
                              'framework': framework,
                              'mode': mode,
                              'welcomePost': welcome.text,
                            }),
                        child: const Text('创建')),
                  ],
                )));
    owner.dispose();
    repository.dispose();
    welcome.dispose();
    if (input == null) return;
    if (input['owner']!.isEmpty || input['repository']!.isEmpty) {
      _showToolError('Owner 和 Repository 不能为空');
      return;
    }
    try {
      final WorkspaceOperationResult result =
          await widget.controller.platformServices.workspace.provisionSite(
              provider: input['provider']!,
              owner: input['owner']!,
              repository: input['repository']!,
              framework: input['framework']!,
              mode: input['mode']!,
              welcomePost: input['welcomePost']!);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(result.ok ? '建站流程已完成' : '建站流程失败')));
      _setState(() {});
    } catch (error) {
      _showToolError(error);
    }
  }

  Widget _aiWorkbench() {
    final DocumentSession? current = session;
    String action = 'polish';
    String instruction = '';
    String output = '';
    bool running = false;
    const List<String> actions = <String>[
      'polish',
      'continue',
      'summary',
      'outline',
      'code',
      'rewrite-selection'
    ];
    return StatefulBuilder(
        builder: (BuildContext context,
                void Function(void Function()) setLocalState) =>
            ListView(padding: const EdgeInsets.all(24), children: <Widget>[
              Text('AI 工作台', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 8),
              const Text(
                  '请求通过同源 AI gateway 执行；没有配置模型或 API Key 时会明确返回不可用，不会伪造结果。'),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                  initialValue: action,
                  decoration: const InputDecoration(labelText: '动作'),
                  items: actions
                      .map((String value) => DropdownMenuItem<String>(
                          value: value, child: Text(value)))
                      .toList(),
                  onChanged: (String? value) =>
                      setLocalState(() => action = value ?? action)),
              const SizedBox(height: 12),
              TextField(
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(
                      labelText: '补充指令（可选）', border: OutlineInputBorder()),
                  onChanged: (String value) => instruction = value),
              const SizedBox(height: 12),
              FilledButton.icon(
                  onPressed: current == null || running
                      ? null
                      : () async {
                          setLocalState(() {
                            running = true;
                            output = '';
                          });
                          try {
                            final WorkspaceAiResult result = await widget
                                .controller.platformServices.workspace
                                .quickWrite(
                                    action: action,
                                    text: current.article.body,
                                    instruction: instruction);
                            setLocalState(() {
                              output = result.ok
                                  ? result.text
                                  : 'AI 请求失败：${result.message ?? '未知错误'}';
                              running = false;
                            });
                          } catch (error) {
                            setLocalState(() {
                              output = 'AI 不可用：$error';
                              running = false;
                            });
                          }
                        },
                  icon: running
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.auto_awesome),
                  label: const Text('执行快速写作')),
              if (output.isNotEmpty) ...<Widget>[
                const SizedBox(height: 16),
                Card(
                    child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              const Text('输出'),
                              const SizedBox(height: 8),
                              SelectableText(output),
                              if (current != null &&
                                  !output.startsWith('AI 请求失败') &&
                                  !output.startsWith('AI 不可用'))
                                Align(
                                    alignment: Alignment.centerRight,
                                    child: OutlinedButton(
                                        onPressed: () async {
                                          final String separator =
                                              current.article.body.isEmpty ||
                                                      current.article.body
                                                          .endsWith('\n')
                                                  ? ''
                                                  : '\n\n';
                                          current.edit(
                                              body:
                                                  '${current.article.body}$separator$output\n');
                                          await widget.controller.save(current);
                                          setLocalState(
                                              () => output = '已追加到当前文章。');
                                        },
                                        child: const Text('追加到正文'))),
                            ]))),
              ],
            ]));
  }

  Widget _imageHostCenter() => ListView(
        padding: const EdgeInsets.all(24),
        children: <Widget>[
          Text('图床', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 8),
          const Text('图片通过 GitHub 图床 gateway 上传，失败时保留可重试的原始字节，不会把凭据写入文章。'),
          const SizedBox(height: 16),
          Card(
              child: ListTile(
                  leading: const Icon(Icons.image_outlined),
                  title: Text(session == null
                      ? '请先打开文章'
                      : '当前文章：${session!.article.title}'),
                  subtitle: const Text('选择图片、指定静态站点并插入 Markdown 图片链接。'),
                  trailing: FilledButton.icon(
                      onPressed: session == null ? null : _uploadImage,
                      icon: const Icon(Icons.upload),
                      label: const Text('选择并上传')))),
        ],
      );
}
