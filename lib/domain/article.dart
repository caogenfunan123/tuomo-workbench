import 'dart:convert';

const Object _articleFieldUnset = Object();

enum ArticleKind { post, page }

class ArticleMetadata {
  const ArticleMetadata({
    this.tags = const <String>[],
    this.categories = const <String>[],
    this.cover,
    this.kind = ArticleKind.post,
    this.templateId,
    this.slug,
    this.extraFrontMatter = const <String, Object?>{},
  });

  final List<String> tags;
  final List<String> categories;
  final String? cover;
  final ArticleKind kind;
  final String? templateId;
  final String? slug;
  final Map<String, Object?> extraFrontMatter;

  ArticleMetadata copyWith({
    List<String>? tags,
    List<String>? categories,
    Object? cover = _articleFieldUnset,
    ArticleKind? kind,
    Object? templateId = _articleFieldUnset,
    Object? slug = _articleFieldUnset,
    Map<String, Object?>? extraFrontMatter,
  }) =>
      ArticleMetadata(
        tags: _unique(tags ?? this.tags),
        categories: _unique(categories ?? this.categories),
        cover: identical(cover, _articleFieldUnset)
            ? this.cover
            : cover as String?,
        kind: kind ?? this.kind,
        templateId: identical(templateId, _articleFieldUnset)
            ? this.templateId
            : templateId as String?,
        slug: identical(slug, _articleFieldUnset) ? this.slug : slug as String?,
        extraFrontMatter: Map<String, Object?>.unmodifiable(
            extraFrontMatter ?? this.extraFrontMatter),
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'tags': tags,
        'categories': categories,
        'cover': cover,
        'kind': kind.name,
        'templateId': templateId,
        'slug': slug,
        'extraFrontMatter': extraFrontMatter,
      };

  factory ArticleMetadata.fromJson(Map<String, Object?> json) =>
      ArticleMetadata(
        tags: _strings(json['tags']),
        categories: _strings(json['categories']),
        cover: json['cover'] as String?,
        kind: ArticleKind.values.byName(json['kind'] as String? ?? 'post'),
        templateId: json['templateId'] as String?,
        slug: json['slug'] as String?,
        extraFrontMatter: Map<String, Object?>.from(
            (json['extraFrontMatter'] as Map?)?.cast<String, Object?>() ??
                <String, Object?>{}),
      );
}

class Article {
  const Article({
    required this.id,
    required this.title,
    required this.body,
    required this.metadata,
    required this.localRevision,
    required this.createdAt,
    required this.updatedAt,
    this.volume,
    this.scheduleAt,
    this.published = false,
  });

  final String id;
  final String title;
  final String body;
  final ArticleMetadata metadata;
  final int localRevision;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String? volume;
  final DateTime? scheduleAt;
  final bool published;

  Article copyWith({
    String? title,
    String? body,
    ArticleMetadata? metadata,
    int? localRevision,
    DateTime? updatedAt,
    Object? volume = _articleFieldUnset,
    Object? scheduleAt = _articleFieldUnset,
    bool? published,
  }) =>
      Article(
        id: id,
        title: title ?? this.title,
        body: body ?? this.body,
        metadata: metadata ?? this.metadata,
        localRevision: localRevision ?? this.localRevision,
        createdAt: createdAt,
        updatedAt: updatedAt ?? this.updatedAt,
        volume: identical(volume, _articleFieldUnset)
            ? this.volume
            : volume as String?,
        scheduleAt: identical(scheduleAt, _articleFieldUnset)
            ? this.scheduleAt
            : scheduleAt as DateTime?,
        published: published ?? this.published,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'title': title,
        'body': body,
        'metadata': metadata.toJson(),
        'localRevision': localRevision,
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
        'volume': volume,
        'scheduleAt': scheduleAt?.toIso8601String(),
        'published': published,
      };

  factory Article.fromJson(Map<String, Object?> json) {
    final Article article = Article(
      id: json['id']! as String,
      title: json['title'] as String? ?? '',
      body: json['body'] as String? ?? '',
      metadata: ArticleMetadata.fromJson(
          (json['metadata'] as Map).cast<String, Object?>()),
      localRevision: json['localRevision'] as int? ?? 1,
      createdAt: DateTime.parse(json['createdAt']! as String),
      updatedAt: DateTime.parse(json['updatedAt']! as String),
      volume: json['volume'] as String?,
      scheduleAt: (json['scheduleAt'] as String?) == null
          ? null
          : DateTime.parse(json['scheduleAt']! as String),
      published: json['published'] as bool? ?? false,
    );
    validateArticle(article);
    return article;
  }

  String encode() => jsonEncode(toJson());
}

Article newArticle(
    {String? id, String title = '', String body = '', DateTime? now}) {
  final DateTime timestamp = now ?? DateTime.now();
  final Article article = Article(
    id: id ?? timestamp.microsecondsSinceEpoch.toString(),
    title: title,
    body: body,
    metadata: const ArticleMetadata(),
    localRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  );
  validateArticle(article);
  return article;
}

void validateArticle(Article article) {
  if (!RegExp(r'^[a-zA-Z0-9_-]{1,100}$').hasMatch(article.id)) {
    throw const FormatException('Invalid article id');
  }
  if (article.localRevision < 1)
    throw const FormatException('Invalid article revision');
  if (article.body.contains('\u0000'))
    throw const FormatException('Article body contains NUL');
}

List<String> _unique(Iterable<String> values) => values
    .map((String value) => value.trim())
    .where((String value) => value.isNotEmpty)
    .toSet()
    .toList(growable: false);
List<String> _strings(Object? value) => value is List
    ? value.whereType<String>().toList(growable: false)
    : const <String>[];
