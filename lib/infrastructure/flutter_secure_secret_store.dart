import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../application/secret_store.dart';

class FlutterSecureSecretStore implements SecretStore {
  FlutterSecureSecretStore({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  static const String _prefix = 'tuomo.secret.';
  final FlutterSecureStorage _storage;

  @override
  Future<SecretRef> put(String value, {String? id}) async {
    if (value.isEmpty)
      throw ArgumentError.value(value, 'value', 'cannot be empty');
    final String key = id ?? DateTime.now().microsecondsSinceEpoch.toString();
    await _storage.write(key: _storageKey(key), value: value);
    return SecretRef(key);
  }

  @override
  Future<String?> get(SecretRef ref) => _storage.read(key: _storageKey(ref.id));

  @override
  Future<void> delete(SecretRef ref) =>
      _storage.delete(key: _storageKey(ref.id));

  String _storageKey(String id) {
    if (!RegExp(r'^[a-zA-Z0-9_-]{1,100}$').hasMatch(id)) {
      throw ArgumentError.value(id, 'id', 'must be a safe secret reference');
    }
    return '$_prefix$id';
  }
}
