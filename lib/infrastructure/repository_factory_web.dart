import '../application/article_repository.dart';
import 'browser_article_repository.dart';

Future<ArticleRepository> createPlatformArticleRepository() async =>
    BrowserArticleRepository();
