import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/auth_service.dart';
import '../services/api_key_service.dart';
import '../services/fcm_service.dart';
import '../services/logger_service.dart';

const _tag = 'AuthProvider';

/// Provider for AuthService
final authServiceProvider = Provider<AuthService>((ref) => AuthService());

/// Provider for ApiKeyService
final apiKeyServiceProvider = Provider<ApiKeyService>((ref) => ApiKeyService());

/// Stream provider for auth state changes
final authStateProvider = StreamProvider<User?>((ref) {
  final authService = ref.watch(authServiceProvider);
  return authService.authStateChanges;
});

/// Provider for current user
final currentUserProvider = Provider<User?>((ref) {
  return ref.watch(authStateProvider).valueOrNull;
});

/// Auth state notifier for login/register/signout actions
class AuthNotifier extends StateNotifier<AsyncValue<void>> {
  final AuthService _authService;
  final ApiKeyService _apiKeyService;

  AuthNotifier(this._authService, this._apiKeyService)
      : super(const AsyncValue.data(null));

  /// Sign in with email and password
  Future<bool> signIn({
    required String email,
    required String password,
  }) async {
    state = const AsyncValue.loading();
    try {
      final credential = await _authService.signInWithEmail(email: email, password: password);

      // Sync API key across devices (downloads from Firestore if exists)
      Log.d(_tag, 'signIn: Syncing API key...');
      await _apiKeyService.syncApiKey(credential.user!.uid);
      Log.d(_tag, 'signIn: API key synced');

      try {
        await FcmService.instance.onUserLogin(credential.user!.uid);
      } catch (_) {
        // FCM is optional, ignore errors
      }
      state = const AsyncValue.data(null);
      return true;
    } catch (e, st) {
      state = AsyncValue.error(e, st);
      return false;
    }
  }

  /// Create new account and generate API key
  Future<String?> register({
    required String email,
    required String password,
  }) async {
    state = const AsyncValue.loading();
    try {
      final credential = await _authService.createAccount(
        email: email,
        password: password,
      );

      // Generate and store API key
      final apiKey = await _apiKeyService.createAndStoreApiKey(
        credential.user!.uid,
      );

      try {
        await FcmService.instance.onUserLogin(credential.user!.uid);
      } catch (_) {
        // FCM is optional, ignore errors
      }
      state = const AsyncValue.data(null);
      return apiKey;
    } catch (e, st) {
      state = AsyncValue.error(e, st);
      return null;
    }
  }

  /// Sign out
  Future<void> signOut() async {
    state = const AsyncValue.loading();
    try {
      await FcmService.instance.onUserLogout();
      await _authService.signOut();
      state = const AsyncValue.data(null);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  /// Regenerate API key
  Future<String?> regenerateApiKey(String userId) async {
    Log.i(_tag, 'regenerateApiKey: Starting for $userId');
    state = const AsyncValue.loading();
    try {
      final newKey = await _apiKeyService.regenerateApiKey(userId);
      Log.i(_tag, 'regenerateApiKey: SUCCESS');
      state = const AsyncValue.data(null);
      return newKey;
    } catch (e, st) {
      Log.e(_tag, 'regenerateApiKey: FAILED', e, st);
      state = AsyncValue.error(e, st);
      return null;
    }
  }

  /// Get stored API key
  Future<String?> getStoredApiKey() async {
    return await _apiKeyService.getStoredApiKey();
  }

  /// Check if user has API key
  Future<bool> hasApiKey() async {
    return await _apiKeyService.hasApiKey();
  }

  /// Clear error state
  void clearError() {
    state = const AsyncValue.data(null);
  }

  /// Change password (requires current password for reauthentication)
  Future<bool> changePassword({
    required String currentPassword,
    required String newPassword,
    required String email,
  }) async {
    Log.i(_tag, 'changePassword: Starting');
    state = const AsyncValue.loading();
    try {
      // First reauthenticate
      await _authService.reauthenticate(email: email, password: currentPassword);
      // Then update password
      await _authService.updatePassword(newPassword);
      Log.i(_tag, 'changePassword: SUCCESS');
      state = const AsyncValue.data(null);
      return true;
    } catch (e, st) {
      Log.e(_tag, 'changePassword: FAILED', e, st);
      state = AsyncValue.error(e, st);
      return false;
    }
  }

  /// Send password reset email
  Future<bool> sendPasswordResetEmail(String email) async {
    Log.i(_tag, 'sendPasswordResetEmail: $email');
    state = const AsyncValue.loading();
    try {
      await _authService.sendPasswordResetEmail(email);
      Log.i(_tag, 'sendPasswordResetEmail: SUCCESS');
      state = const AsyncValue.data(null);
      return true;
    } catch (e, st) {
      Log.e(_tag, 'sendPasswordResetEmail: FAILED', e, st);
      state = AsyncValue.error(e, st);
      return false;
    }
  }

  /// Update display name
  Future<bool> updateDisplayName(String displayName) async {
    Log.i(_tag, 'updateDisplayName: $displayName');
    state = const AsyncValue.loading();
    try {
      await _authService.updateDisplayName(displayName);
      Log.i(_tag, 'updateDisplayName: SUCCESS');
      state = const AsyncValue.data(null);
      return true;
    } catch (e, st) {
      Log.e(_tag, 'updateDisplayName: FAILED', e, st);
      state = AsyncValue.error(e, st);
      return false;
    }
  }

  /// Delete account (requires reauthentication)
  Future<bool> deleteAccount({
    required String password,
    required String email,
  }) async {
    Log.i(_tag, 'deleteAccount: Starting');
    state = const AsyncValue.loading();
    try {
      // First reauthenticate
      await _authService.reauthenticate(email: email, password: password);
      // Then delete
      await _authService.deleteAccount();
      Log.i(_tag, 'deleteAccount: SUCCESS');
      state = const AsyncValue.data(null);
      return true;
    } catch (e, st) {
      Log.e(_tag, 'deleteAccount: FAILED', e, st);
      state = AsyncValue.error(e, st);
      return false;
    }
  }
}

/// Provider for auth actions
final authNotifierProvider =
    StateNotifierProvider<AuthNotifier, AsyncValue<void>>((ref) {
  final authService = ref.watch(authServiceProvider);
  final apiKeyService = ref.watch(apiKeyServiceProvider);
  return AuthNotifier(authService, apiKeyService);
});

/// Helper to get human-readable error messages
String getAuthErrorMessage(Object error) {
  if (error is FirebaseAuthException) {
    switch (error.code) {
      case 'user-not-found':
        return 'No account found with this email.';
      case 'wrong-password':
      case 'invalid-credential':
        return 'Incorrect email or password.';
      case 'email-already-in-use':
        return 'An account already exists with this email.';
      case 'weak-password':
        return 'Password is too weak. Use at least 6 characters.';
      case 'invalid-email':
        return 'Invalid email address.';
      case 'user-disabled':
        return 'This account has been disabled.';
      case 'too-many-requests':
        return 'Too many attempts. Please try again later.';
      case 'network-request-failed':
        return 'Network error. Please check your connection.';
      default:
        return error.message ?? 'Authentication failed.';
    }
  }
  // Handle other error types
  final errorString = error.toString().toLowerCase();
  if (errorString.contains('keychain') || errorString.contains('osstatus')) {
    return 'Keychain access error. Try restarting the app.';
  }
  if (errorString.contains('network')) {
    return 'Network error. Please check your connection.';
  }
  return error.toString();
}
