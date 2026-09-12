import 'package:flutter/material.dart';

class MarkdownPreview extends StatelessWidget {
  const MarkdownPreview({super.key, required this.markdown});
  final String markdown;

  @override
  Widget build(BuildContext context) {
    if (markdown.trim().isEmpty) {
      return const Text('预览区域\n\n输入 Markdown 后将在这里显示。');
    }
    final List<Widget> blocks = <Widget>[];
    final List<String> lines = markdown.replaceAll('\r\n', '\n').split('\n');
    int index = 0;
    while (index < lines.length) {
      final String line = lines[index];
      if (line.trim().isEmpty) {
        blocks.add(const SizedBox(height: 8));
        index++;
        continue;
      }
      final RegExpMatch? fence = RegExp(r'^```(.*)$').firstMatch(line);
      if (fence != null) {
        final String language = fence.group(1)?.trim() ?? '';
        final List<String> code = <String>[];
        index++;
        while (index < lines.length &&
            !RegExp(r'^```\s*$').hasMatch(lines[index])) {
          code.add(lines[index]);
          index++;
        }
        if (index < lines.length) index++;
        if (language.isNotEmpty) {
          blocks.add(Text(language.toLowerCase(),
              style: Theme.of(context).textTheme.labelSmall));
        }
        blocks.add(_codeBlock(
            context, code.join('\n'), language.toLowerCase() == 'mermaid'));
        continue;
      }
      final RegExpMatch? heading =
          RegExp(r'^(#{1,6})\s+(.+?)\s*#*$').firstMatch(line);
      if (heading != null) {
        final int level = heading.group(1)!.length;
        blocks.add(Padding(
            padding: const EdgeInsets.only(top: 8),
            child: SelectableText(heading.group(2)!,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold, fontSize: 22 - (level * 2)))));
        index++;
        continue;
      }
      if (_isTableStart(lines, index)) {
        final List<List<String>> rows = <List<String>>[
          _tableCells(lines[index])
        ];
        index += 2;
        while (index < lines.length && _isTableLine(lines[index])) {
          rows.add(_tableCells(lines[index]));
          index++;
        }
        blocks.add(_tableBlock(context, rows));
        continue;
      }
      if (line.trim().startsWith(r'$$')) {
        final List<String> math = <String>[];
        final String value = line.trim().substring(2);
        if (value.endsWith(r'$$') && value.length > 2) {
          math.add(value.substring(0, value.length - 2));
          index++;
        } else {
          if (value.isNotEmpty) math.add(value);
          index++;
          while (index < lines.length && !lines[index].trim().endsWith(r'$$')) {
            math.add(lines[index]);
            index++;
          }
          if (index < lines.length) {
            final String last = lines[index].trim();
            math.add(last.substring(0, last.length - 2));
            index++;
          }
        }
        blocks.add(Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
                border:
                    Border.all(color: Theme.of(context).colorScheme.primary),
                borderRadius: BorderRadius.circular(8)),
            child: SelectableText(math.join('\n'),
                style: const TextStyle(fontFamily: 'monospace'))));
        continue;
      }
      if (RegExp(r'^\s*[-*+]\s+').hasMatch(line)) {
        final List<Widget> items = <Widget>[];
        while (index < lines.length &&
            RegExp(r'^\s*[-*+]\s+').hasMatch(lines[index])) {
          items.add(_listItem(
              '•', lines[index].replaceFirst(RegExp(r'^\s*[-*+]\s+'), '')));
          index++;
        }
        blocks.add(Column(
            crossAxisAlignment: CrossAxisAlignment.start, children: items));
        continue;
      }
      if (RegExp(r'^\s*\d+[.)]\s+').hasMatch(line)) {
        final List<Widget> items = <Widget>[];
        while (index < lines.length &&
            RegExp(r'^\s*\d+[.)]\s+').hasMatch(lines[index])) {
          final RegExpMatch match =
              RegExp(r'^\s*(\d+)[.)]\s+(.*)$').firstMatch(lines[index])!;
          items.add(_listItem('${match.group(1)}.', match.group(2)!));
          index++;
        }
        blocks.add(Column(
            crossAxisAlignment: CrossAxisAlignment.start, children: items));
        continue;
      }
      if (line.trimLeft().startsWith('>')) {
        final List<String> quote = <String>[];
        while (
            index < lines.length && lines[index].trimLeft().startsWith('>')) {
          quote.add(lines[index].replaceFirst(RegExp(r'^\s*>\s?'), ''));
          index++;
        }
        blocks.add(Container(
            width: double.infinity,
            padding: const EdgeInsets.only(left: 12),
            decoration: BoxDecoration(
                border: Border(
                    left: BorderSide(
                        color: Theme.of(context).colorScheme.primary,
                        width: 3))),
            child: SelectableText(quote.join('\n'))));
        continue;
      }
      final List<String> paragraph = <String>[line];
      index++;
      while (index < lines.length && !_startsBlock(lines, index)) {
        paragraph.add(lines[index]);
        index++;
      }
      blocks.add(SelectableText(paragraph.join('\n')));
    }
    return Column(
        crossAxisAlignment: CrossAxisAlignment.start, children: blocks);
  }

  Widget _codeBlock(BuildContext context, String value, bool mermaid) =>
      Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(8)),
          child: SelectableText(value,
              style:
                  TextStyle(
                      fontFamily: 'monospace',
                      color: mermaid
                          ? Theme.of(context).colorScheme.primary
                          : null)));

  Widget _listItem(String marker, String value) =>
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
        SizedBox(width: 28, child: Text(marker)),
        Expanded(child: SelectableText(value)),
      ]);

  Widget _tableBlock(BuildContext context, List<List<String>> rows) {
    final int columns = rows.fold<int>(
        0,
        (int value, List<String> row) =>
            value > row.length ? value : row.length);
    return SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Table(
            defaultColumnWidth: const IntrinsicColumnWidth(),
            border: TableBorder.all(color: Theme.of(context).dividerColor),
            children:
                rows.asMap().entries.map((MapEntry<int, List<String>> entry) {
              final bool header = entry.key == 0;
              return TableRow(
                  decoration: header
                      ? BoxDecoration(
                          color: Theme.of(context)
                              .colorScheme
                              .surfaceContainerHighest)
                      : null,
                  children: List<Widget>.generate(
                      columns,
                      (int index) => Padding(
                          padding: const EdgeInsets.all(8),
                          child: SelectableText(
                              index < entry.value.length
                                  ? entry.value[index]
                                  : '',
                              style: header
                                  ? const TextStyle(fontWeight: FontWeight.bold)
                                  : null))));
            }).toList()));
  }
}

bool _isTableLine(String line) =>
    line.trimLeft().startsWith('|') && line.trimRight().endsWith('|');

bool _isTableSeparator(String line) =>
    _isTableLine(line) &&
    _tableCells(line).isNotEmpty &&
    _tableCells(line)
        .every((String cell) => RegExp(r'^:?-{3,}:?$').hasMatch(cell));

bool _isTableStart(List<String> lines, int index) =>
    index + 1 < lines.length &&
    _isTableLine(lines[index]) &&
    _isTableSeparator(lines[index + 1]);

List<String> _tableCells(String line) => line
    .trim()
    .replaceFirst(RegExp(r'^\|'), '')
    .replaceFirst(RegExp(r'\|$'), '')
    .split('|')
    .map((String value) => value.trim())
    .toList();

bool _startsBlock(List<String> lines, int index) {
  final String line = lines[index];
  return line.trim().isEmpty ||
      RegExp(r'^```|^(#{1,6})\s+|^\s*[-*+]\s+|^\s*\d+[.)]\s+|^\s*>|^\s*\$\$')
          .hasMatch(line) ||
      _isTableStart(lines, index);
}
