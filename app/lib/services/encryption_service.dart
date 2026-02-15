import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:encrypt/encrypt.dart' as enc;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'secure_storage_service.dart';

void _log(String message) {
  debugPrint('[EncryptionService] $message');
}

/// Exception thrown when encryption fails
class EncryptionException implements Exception {
  final String message;
  EncryptionException(this.message);

  @override
  String toString() => 'EncryptionException: $message';
}

/// Service for encrypting/decrypting messages using API key-derived keys
class EncryptionService {
  static const _saltPrefix = 'cachebash_e2e_v1_';
  static const _keyIterations = 100000;
  static const _keyLength = 32; // 256 bits for AES-256

  final SecureStorageService _storage;
  enc.Key? _cachedKey;
  String? _cachedApiKeyHash;

  EncryptionService({SecureStorageService? storage})
      : _storage = storage ?? SecureStorageService();

  /// Derive encryption key from API key using PBKDF2
  Future<enc.Key> _deriveKey(String apiKey) async {
    // Check cache
    final apiKeyHash = sha256.convert(utf8.encode(apiKey)).toString();
    if (_cachedKey != null && _cachedApiKeyHash == apiKeyHash) {
      return _cachedKey!;
    }

    // Create salt from prefix + hash of API key (deterministic)
    final saltString = _saltPrefix + apiKeyHash.substring(0, 16);
    final salt = utf8.encode(saltString);

    // Use PBKDF2 to derive key
    final keyBytes = _pbkdf2(
      utf8.encode(apiKey),
      salt,
      _keyIterations,
      _keyLength,
    );

    _cachedKey = enc.Key(keyBytes);
    _cachedApiKeyHash = apiKeyHash;
    return _cachedKey!;
  }

  /// PBKDF2 key derivation
  Uint8List _pbkdf2(
    List<int> password,
    List<int> salt,
    int iterations,
    int keyLength,
  ) {
    final hmac = Hmac(sha256, password);
    final blocks = (keyLength / 32).ceil();
    final result = <int>[];

    for (var i = 1; i <= blocks; i++) {
      var block = hmac
          .convert([...salt, (i >> 24) & 0xff, (i >> 16) & 0xff, (i >> 8) & 0xff, i & 0xff]).bytes;
      var u = List<int>.from(block);

      for (var j = 1; j < iterations; j++) {
        block = hmac.convert(block).bytes;
        for (var k = 0; k < u.length; k++) {
          u[k] ^= block[k];
        }
      }
      result.addAll(u);
    }

    return Uint8List.fromList(result.sublist(0, keyLength));
  }

  /// Get the stored API key
  Future<String?> _getApiKey() async {
    return await _storage.getApiKey();
  }

  /// Encrypt plaintext using AES-256-CBC
  /// Returns base64 encoded string with IV prepended
  /// Throws EncryptionException if encryption fails (never falls back to plaintext)
  Future<String> encrypt(String plaintext) async {
    final apiKey = await _getApiKey();
    if (apiKey == null) {
      throw EncryptionException('No API key available for encryption');
    }

    try {
      final key = await _deriveKey(apiKey);
      final iv = enc.IV.fromSecureRandom(16);
      final encrypter = enc.Encrypter(enc.AES(key, mode: enc.AESMode.cbc));

      final encrypted = encrypter.encrypt(plaintext, iv: iv);

      // Prepend IV to ciphertext (IV is not secret, just needs to be unique)
      final combined = Uint8List.fromList([...iv.bytes, ...encrypted.bytes]);
      return base64.encode(combined);
    } catch (e) {
      throw EncryptionException('Encryption failed: $e');
    }
  }

  /// Decrypt ciphertext
  /// Expects base64 encoded string with IV prepended
  Future<String?> decrypt(String ciphertext) async {
    final apiKey = await _getApiKey();
    if (apiKey == null) {
      return null;
    }

    try {
      final key = await _deriveKey(apiKey);
      final combined = base64.decode(ciphertext);

      if (combined.length < 17) {
        return null;
      }

      // Extract IV (first 16 bytes) and ciphertext
      final iv = enc.IV(Uint8List.fromList(combined.sublist(0, 16)));
      final encryptedBytes = Uint8List.fromList(combined.sublist(16));

      final encrypter = enc.Encrypter(enc.AES(key, mode: enc.AESMode.cbc));
      return encrypter.decrypt(enc.Encrypted(encryptedBytes), iv: iv);
    } catch (e) {
      _log('Decryption failed');
      return null;
    }
  }

  /// Check if a string appears to be encrypted (base64 with proper length)
  bool isEncrypted(String? text) {
    if (text == null || text.isEmpty) return false;

    try {
      final decoded = base64.decode(text);
      // Encrypted text should be at least IV (16) + 1 block (16) = 32 bytes
      return decoded.length >= 32;
    } catch (_) {
      return false;
    }
  }

  /// Decrypt if encrypted, otherwise return original
  Future<String> decryptIfNeeded(String? text) async {
    if (text == null || text.isEmpty) return text ?? '';

    if (isEncrypted(text)) {
      final decrypted = await decrypt(text);
      return decrypted ?? text; // Fallback to original if decryption fails
    }
    return text;
  }

  /// Clear cached key (call when API key changes)
  void clearCache() {
    _cachedKey = null;
    _cachedApiKeyHash = null;
    _log('Encryption cache cleared');
  }
}

/// Provider for encryption service
final encryptionServiceProvider = Provider<EncryptionService>((ref) {
  return EncryptionService();
});
