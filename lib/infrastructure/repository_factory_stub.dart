import '../application/article_repository.dart';

Future<ArticleRepository> createPlatformArticleRepository() async =>
    MemoryArticleRepository();
