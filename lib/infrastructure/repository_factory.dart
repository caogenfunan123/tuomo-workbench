import '../application/article_repository.dart';
import 'repository_factory_stub.dart'
    if (dart.library.io) 'repository_factory_io.dart'
    if (dart.library.html) 'repository_factory_web.dart';

Future<ArticleRepository> createArticleRepository() =>
    createPlatformArticleRepository();
