import 'package:path_provider/path_provider.dart';

import '../application/article_repository.dart';
import 'json_file_article_repository.dart';

Future<ArticleRepository> createPlatformArticleRepository() async {
  final directory = await getApplicationSupportDirectory();
  return JsonFileArticleRepository(directory);
}
