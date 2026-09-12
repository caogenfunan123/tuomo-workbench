class SecretRef {
  const SecretRef(this.id);
  final String id;
}

abstract interface class SecretStore {
  Future<SecretRef> put(String value, {String? id});
  Future<String?> get(SecretRef ref);
  Future<void> delete(SecretRef ref);
}
