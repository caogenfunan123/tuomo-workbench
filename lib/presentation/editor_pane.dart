import 'dart:async';

import 'package:flutter/material.dart';

import '../application/document_export.dart';
import '../application/editor_session.dart';
import '../domain/article.dart';
import 'markdown_preview.dart';

export 'markdown_preview.dart';

class EditorPane extends StatefulWidget {
  const EditorPane(
      {super.key,
      required this.session,
      required this.onSave,
      this.onExport,
      this.onExportFormat,
      this.onPreview,
      this.editorFontSize = 16,
      this.typewriterMode = false});
  final DocumentSession session;
  final Future<void> Function() onSave;
  final Future<void> Function()? onExport;
  final Future<void> Function(DocumentExportFormat format)? onExportFormat;
  final Future<void> Function()? onPreview;
  final double editorFontSize;
  final bool typewriterMode;

  @override
  State<EditorPane> createState() => _EditorPaneState();
}

class _EditorPaneState extends State<EditorPane> {
  late final TextEditingController title;
  late final TextEditingController body;
  late final TextEditingController tags;
  late final TextEditingController categories;
  late final TextEditingController cover;
  late final TextEditingController slug;
  late final TextEditingController templateId;
  late final TextEditingController volume;
  late final TextEditingController scheduleAt;
  late final ScrollController bodyScroll;
  Timer? saveTimer;
  bool syncing = false;

  @override
  void initState() {
    super.initState();
    title = TextEditingController(text: widget.session.article.title)
      ..addListener(_editTitle);
    body = TextEditingController(text: widget.session.article.body)
      ..addListener(_editBody);
    bodyScroll = ScrollController();
    tags = TextEditingController(
        text: widget.session.article.metadata.tags.join(', '))
      ..addListener(_editMetadata);
    categories = TextEditingController(
        text: widget.session.article.metadata.categories.join(', '))
      ..addListener(_editMetadata);
    cover =
        TextEditingController(text: widget.session.article.metadata.cover ?? '')
          ..addListener(_editExtendedMetadata);
    slug =
        TextEditingController(text: widget.session.article.metadata.slug ?? '')
          ..addListener(_editExtendedMetadata);
    templateId = TextEditingController(
        text: widget.session.article.metadata.templateId ?? '')
      ..addListener(_editExtendedMetadata);
    volume = TextEditingController(text: widget.session.article.volume ?? '')
      ..addListener(_editExtendedMetadata);
    scheduleAt = TextEditingController(
        text: widget.session.article.scheduleAt?.toIso8601String() ?? '')
      ..addListener(_editExtendedMetadata);
    widget.session.addListener(_changed);
  }

  @override
  void didUpdateWidget(covariant EditorPane oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.session != widget.session) {
      saveTimer?.cancel();
      oldWidget.session.removeListener(_changed);
      widget.session.addListener(_changed);
      syncing = true;
      title.text = widget.session.article.title;
      body.text = widget.session.article.body;
      tags.text = widget.session.article.metadata.tags.join(', ');
      categories.text = widget.session.article.metadata.categories.join(', ');
      cover.text = widget.session.article.metadata.cover ?? '';
      slug.text = widget.session.article.metadata.slug ?? '';
      templateId.text = widget.session.article.metadata.templateId ?? '';
      volume.text = widget.session.article.volume ?? '';
      scheduleAt.text =
          widget.session.article.scheduleAt?.toIso8601String() ?? '';
      syncing = false;
    }
  }

  void _editTitle() {
    if (!syncing) {
      widget.session.edit(title: title.text);
      _scheduleSave();
    }
  }

  void _editBody() {
    if (!syncing) {
      widget.session.edit(body: body.text);
      _scheduleSave();
      _scheduleTypewriterScroll();
    }
  }

  void _scheduleTypewriterScroll() {
    if (!widget.typewriterMode) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !bodyScroll.hasClients) return;
      final int offset = body.selection.baseOffset;
      if (offset < 0) return;
      final int bounded = offset.clamp(0, body.text.length);
      final int line = body.text.substring(0, bounded).split('\n').length - 1;
      final double lineHeight = widget.editorFontSize * 1.5;
      final double target = (line * lineHeight - 180)
          .clamp(0, bodyScroll.position.maxScrollExtent)
          .toDouble();
      if ((bodyScroll.offset - target).abs() > 1) {
        bodyScroll.animateTo(target,
            duration: const Duration(milliseconds: 120), curve: Curves.easeOut);
      }
    });
  }

  void _editMetadata() {
    if (!syncing) {
      widget.session.edit(
          metadata: widget.session.article.metadata.copyWith(
              tags: _split(tags.text), categories: _split(categories.text)));
      _scheduleSave();
    }
  }

  void _changeKind(ArticleKind? kind) {
    if (kind == null) return;
    widget.session
        .edit(metadata: widget.session.article.metadata.copyWith(kind: kind));
    _scheduleSave();
  }

  void _changePublished(bool? published) {
    if (published == null) return;
    widget.session.edit(published: published);
    _scheduleSave();
  }

  void _editExtendedMetadata() {
    if (!syncing) {
      final String schedule = scheduleAt.text.trim();
      widget.session.edit(
          metadata: widget.session.article.metadata.copyWith(
              cover: cover.text.trim(),
              slug: slug.text.trim(),
              templateId: templateId.text.trim()),
          volume: volume.text.trim(),
          scheduleAt: schedule.isEmpty ? null : DateTime.tryParse(schedule));
      _scheduleSave();
    }
  }

  List<String> _split(String value) => value
      .split(',')
      .map((String item) => item.trim())
      .where((String item) => item.isNotEmpty)
      .toSet()
      .toList();

  void _changed() => setState(() {});

  void _scheduleSave() {
    saveTimer?.cancel();
    saveTimer = Timer(const Duration(milliseconds: 700), () async {
      if (!mounted || !widget.session.isDirty) return;
      try {
        await widget.onSave();
      } catch (_) {
        // The session keeps SaveStatus.failed and the user can retry manually.
      }
    });
  }

  Future<void> _saveNow() async {
    saveTimer?.cancel();
    try {
      await widget.onSave();
    } catch (_) {
      // The session exposes the failure state; keep the editor open.
    }
  }

  Future<void> _exportNow() async {
    final Future<void> Function()? export = widget.onExport;
    if (export == null) return;
    try {
      await export();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Markdown 已导出')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('导出不可用：$error')));
      }
    }
  }

  Future<void> _exportFormatNow(DocumentExportFormat format) async {
    final Future<void> Function(DocumentExportFormat format)? export =
        widget.onExportFormat;
    if (export == null) return;
    try {
      await export(format);
      if (mounted) {
        final String label = switch (format) {
          DocumentExportFormat.markdown => 'Markdown',
          DocumentExportFormat.html => 'HTML',
          DocumentExportFormat.pdf => 'PDF',
          DocumentExportFormat.docx => 'DOCX',
          DocumentExportFormat.epub => 'EPUB',
          DocumentExportFormat.png => 'PNG',
        };
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$label 已导出')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('导出不可用：$error')));
      }
    }
  }

  Future<void> _previewNow() async {
    final Future<void> Function()? preview = widget.onPreview;
    if (preview == null) return;
    try {
      await preview();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('预览不可用：$error')));
      }
    }
  }

  String _statusLabel() => switch (widget.session.status) {
        SaveStatus.clean => '已保存',
        SaveStatus.dirty => '未保存',
        SaveStatus.saving => '保存中…',
        SaveStatus.saved => '已保存',
        SaveStatus.failed => '保存失败',
      };

  @override
  void dispose() {
    saveTimer?.cancel();
    if (widget.session.isDirty) unawaited(widget.onSave());
    widget.session.removeListener(_changed);
    title.dispose();
    body.dispose();
    tags.dispose();
    categories.dispose();
    cover.dispose();
    slug.dispose();
    templateId.dispose();
    volume.dispose();
    scheduleAt.dispose();
    bodyScroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(children: <Widget>[
              Expanded(
                  child: TextField(
                      controller: title,
                      style: Theme.of(context).textTheme.headlineSmall,
                      decoration: const InputDecoration(
                          hintText: '标题', border: InputBorder.none))),
              if (widget.onExportFormat != null)
                PopupMenuButton<DocumentExportFormat>(
                    tooltip: '导出文档',
                    icon: const Icon(Icons.download_outlined),
                    onSelected: _exportFormatNow,
                    itemBuilder: (BuildContext context) =>
                        const <PopupMenuEntry<DocumentExportFormat>>[
                          PopupMenuItem(
                              value: DocumentExportFormat.markdown,
                              child: Text('导出 Markdown')),
                          PopupMenuItem(
                              value: DocumentExportFormat.html,
                              child: Text('导出 HTML')),
                          PopupMenuItem(
                              value: DocumentExportFormat.pdf,
                              child: Text('导出 PDF')),
                          PopupMenuItem(
                              value: DocumentExportFormat.docx,
                              child: Text('导出 DOCX')),
                          PopupMenuItem(
                              value: DocumentExportFormat.epub,
                              child: Text('导出 EPUB')),
                          PopupMenuItem(
                              value: DocumentExportFormat.png,
                              child: Text('导出 PNG 长图')),
                        ])
              else if (widget.onExport != null)
                IconButton(
                    onPressed: _exportNow,
                    tooltip: '导出 Markdown',
                    icon: const Icon(Icons.download_outlined)),
              if (widget.onPreview != null)
                IconButton(
                    onPressed: _previewNow,
                    tooltip: '打开预览',
                    icon: const Icon(Icons.open_in_new)),
              FilledButton.icon(
                  onPressed: widget.session.isDirty &&
                          widget.session.status != SaveStatus.saving
                      ? _saveNow
                      : null,
                  icon: const Icon(Icons.save),
                  label: Text(_statusLabel()))
            ]),
            const Divider(),
            Row(children: <Widget>[
              Expanded(
                  child: TextField(
                      controller: tags,
                      decoration: const InputDecoration(
                          labelText: '标签', hintText: '用逗号分隔'))),
              const SizedBox(width: 12),
              Expanded(
                  child: TextField(
                      controller: categories,
                      decoration: const InputDecoration(
                          labelText: '分类', hintText: '用逗号分隔'))),
              const SizedBox(width: 12),
              DropdownButton<ArticleKind>(
                  value: widget.session.article.metadata.kind,
                  onChanged: _changeKind,
                  items: const <DropdownMenuItem<ArticleKind>>[
                    DropdownMenuItem(
                        value: ArticleKind.post, child: Text('文章')),
                    DropdownMenuItem(
                        value: ArticleKind.page, child: Text('页面')),
                  ]),
              const SizedBox(width: 12),
              DropdownButton<bool>(
                  value: widget.session.article.published,
                  onChanged: _changePublished,
                  items: const <DropdownMenuItem<bool>>[
                    DropdownMenuItem(value: false, child: Text('草稿')),
                    DropdownMenuItem(value: true, child: Text('已发布')),
                  ]),
            ]),
            const SizedBox(height: 12),
            Wrap(spacing: 12, runSpacing: 4, children: <Widget>[
              SizedBox(
                  width: 180,
                  child: TextField(
                      controller: cover,
                      decoration: const InputDecoration(labelText: '封面 URL'))),
              SizedBox(
                  width: 150,
                  child: TextField(
                      controller: slug,
                      decoration: const InputDecoration(labelText: 'Slug'))),
              SizedBox(
                  width: 150,
                  child: TextField(
                      controller: templateId,
                      decoration: const InputDecoration(labelText: '模板 ID'))),
              SizedBox(
                  width: 120,
                  child: TextField(
                      controller: volume,
                      decoration: const InputDecoration(labelText: '卷宗'))),
              SizedBox(
                  width: 220,
                  child: TextField(
                      controller: scheduleAt,
                      decoration: const InputDecoration(
                          labelText: '计划发布时间', hintText: 'ISO-8601'))),
            ]),
            const SizedBox(height: 12),
            Expanded(
                child: Row(children: <Widget>[
              Expanded(
                  child: TextField(
                      controller: body,
                      scrollController: bodyScroll,
                      style: TextStyle(fontSize: widget.editorFontSize),
                      expands: true,
                      maxLines: null,
                      minLines: null,
                      decoration: const InputDecoration(
                          hintText: '使用 Markdown 开始写作…',
                          border: InputBorder.none),
                      textAlignVertical: TextAlignVertical.top)),
              const VerticalDivider(width: 24),
              Expanded(
                  child: SingleChildScrollView(
                      padding: const EdgeInsets.all(12),
                      child: MarkdownPreview(markdown: body.text)))
            ])),
          ]));
}
