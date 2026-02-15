import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_app_badger/flutter_app_badger.dart';
import 'package:go_router/go_router.dart';

import 'logger_service.dart';

/// Background message handler - must be top-level function
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  debugPrint('[FCM] Background message: ${message.messageId}');
}

const _tag = 'FcmService';

/// Service for Firebase Cloud Messaging (FCM) token management
class FcmService with WidgetsBindingObserver {
  static final FcmService instance = FcmService._();

  FcmService._();

  final FirebaseMessaging _messaging = FirebaseMessaging.instance;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseAuth _auth = FirebaseAuth.instance;

  String? _currentToken;
  GoRouter? _router;

  /// Initialize FCM and request permissions
  Future<void> initialize({GoRouter? router}) async {
    _router = router;
    // Skip FCM on desktop platforms
    if (Platform.isMacOS || Platform.isWindows || Platform.isLinux) {
      Log.d(_tag, 'initialize: Skipping - not supported on desktop');
      return;
    }

    Log.d(_tag, 'initialize: Requesting permissions...');
    // Request permission (iOS and web)
    final settings = await _messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
    );

    Log.d(_tag, 'initialize: Permission status: ${settings.authorizationStatus}');

    if (settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional) {
      // Set foreground notification presentation options
      await _messaging.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );

      // Clear badge when app opens
      await _clearBadge();

      await _setupToken();
      _setupTokenRefresh();
      _setupForegroundHandler();
      await _setupNotificationHandlers();

      // Register lifecycle observer to sync token on app resume
      WidgetsBinding.instance.addObserver(this);

      Log.i(_tag, 'initialize: SUCCESS - FCM initialized');
    } else {
      Log.w(_tag, 'initialize: Permission denied');
    }
  }

  /// Handle app lifecycle changes
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      Log.d(_tag, 'didChangeAppLifecycleState: App resumed, syncing token');
      _syncTokenIfNeeded();
      _clearBadge();
    }
  }

  /// Sync token if it has changed
  Future<void> _syncTokenIfNeeded() async {
    try {
      final token = await _messaging.getToken();
      if (_isValidFcmToken(token) && token != _currentToken) {
        Log.d(_tag, '_syncTokenIfNeeded: Token changed, updating');
        _currentToken = token;
        await _saveTokenToFirestore(token!);
      }
    } catch (e, stack) {
      Log.e(_tag, '_syncTokenIfNeeded: Failed', e, stack);
    }
  }

  /// Validate FCM token format
  bool _isValidFcmToken(String? token) =>
      token != null && token.isNotEmpty && token.length >= 100;

  /// Clean up resources
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
  }

  /// Get and store FCM token
  Future<void> _setupToken() async {
    Log.d(_tag, '_setupToken: Getting token...');
    try {
      final token = await _messaging.getToken();
      if (_isValidFcmToken(token)) {
        _currentToken = token;
        Log.d(_tag, '_setupToken: Token received: ${_currentToken!.substring(0, 20)}...');
        await _saveTokenToFirestore(_currentToken!);
      } else {
        Log.w(_tag, '_setupToken: Token is null or invalid');
      }
    } catch (e, stack) {
      Log.e(_tag, '_setupToken: Failed to get token', e, stack);
    }
  }

  /// Listen for token refresh
  void _setupTokenRefresh() {
    Log.d(_tag, '_setupTokenRefresh: Setting up listener');
    _messaging.onTokenRefresh.listen((newToken) async {
      Log.d(_tag, 'onTokenRefresh: Token refreshed');
      if (!_isValidFcmToken(newToken)) {
        Log.w(_tag, 'onTokenRefresh: New token is invalid, ignoring');
        return;
      }
      // Delete old token document if exists
      if (_currentToken != null) {
        await _deleteTokenFromFirestore(_currentToken!);
      }
      _currentToken = newToken;
      await _saveTokenToFirestore(newToken);
    });
  }

  /// Handle foreground messages
  void _setupForegroundHandler() {
    Log.d(_tag, '_setupForegroundHandler: Setting up listener');
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      Log.d(_tag, 'onMessage: Received - id=${message.messageId}, title=${message.notification?.title}');
    });
  }

  /// Setup notification tap handlers
  Future<void> _setupNotificationHandlers() async {
    // Handle notification tap when app was terminated
    final initialMessage = await _messaging.getInitialMessage();
    if (initialMessage != null) {
      Log.d(_tag, '_setupNotificationHandlers: App launched from notification');
      _handleNotificationTap(initialMessage);
    }

    // Handle notification tap when app is in background
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      Log.d(_tag, '_setupNotificationHandlers: Notification tapped from background');
      _handleNotificationTap(message);
    });
  }

  /// Handle notification tap navigation
  void _handleNotificationTap(RemoteMessage message) {
    if (_router == null) {
      Log.w(_tag, '_handleNotificationTap: Router not available');
      return;
    }

    final type = message.data['type'] ?? '';
    final taskId = message.data['taskId'] ?? '';

    switch (type) {
      case 'question':
      case 'question_asked':
        final messageId = message.data['messageId'] ?? message.data['questionId'] ?? taskId;
        if (messageId.isNotEmpty) {
          Log.d(_tag, '_handleNotificationTap: Navigating to question $messageId');
          _router!.go('/questions/$messageId');
        }
        break;
      case 'dream_update':
      case 'dream_morning_report':
      case 'dream_budget_warning':
        if (taskId.isNotEmpty) {
          Log.d(_tag, '_handleNotificationTap: Navigating to dream $taskId');
          _router!.go('/dreams/$taskId');
        }
        break;
      case 'sprint_complete':
      case 'sprint_blocked':
      case 'sprint_wave_complete':
        final sprintId = message.data['sprintId'] ?? taskId;
        if (sprintId.isNotEmpty) {
          Log.d(_tag, '_handleNotificationTap: Navigating to sprint $sprintId');
          _router!.go('/sprints/$sprintId');
        }
        break;
      default:
        // Fallback: try messageId/questionId, then taskId, then home
        final messageId = message.data['messageId'] ?? message.data['questionId'];
        if (messageId?.isNotEmpty ?? false) {
          _router!.go('/questions/$messageId');
        } else if (taskId.isNotEmpty) {
          _router!.go('/tasks');
        } else {
          Log.w(_tag, '_handleNotificationTap: No route found, going home');
          _router!.go('/home');
        }
    }
  }

  /// Save FCM token to Firestore
  Future<void> _saveTokenToFirestore(String token) async {
    final user = _auth.currentUser;
    if (user == null) {
      Log.w(_tag, '_saveTokenToFirestore: No user logged in');
      return;
    }

    final deviceId = _getDeviceId(token);
    final platform = Platform.isIOS ? 'ios'
        : Platform.isAndroid ? 'android'
        : Platform.isMacOS ? 'macos'
        : 'unknown';

    Log.d(_tag, '_saveTokenToFirestore: Saving device $deviceId ($platform)');
    try {
      await _firestore.doc('users/${user.uid}/devices/$deviceId').set({
        'fcmToken': token,
        'platform': platform,
        'lastSeen': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
      Log.d(_tag, '_saveTokenToFirestore: Success');
    } catch (e, stack) {
      Log.e(_tag, '_saveTokenToFirestore: Failed', e, stack);
    }
  }

  /// Delete FCM token from Firestore
  Future<void> _deleteTokenFromFirestore(String token) async {
    final user = _auth.currentUser;
    if (user == null) {
      Log.w(_tag, '_deleteTokenFromFirestore: No user logged in');
      return;
    }

    final deviceId = _getDeviceId(token);
    Log.d(_tag, '_deleteTokenFromFirestore: Deleting device $deviceId');
    try {
      await _firestore.doc('users/${user.uid}/devices/$deviceId').delete();
      Log.d(_tag, '_deleteTokenFromFirestore: Success');
    } catch (e, stack) {
      Log.e(_tag, '_deleteTokenFromFirestore: Failed', e, stack);
    }
  }

  /// Generate device ID from token (first 16 chars of token hash)
  String _getDeviceId(String token) {
    return token.hashCode.toRadixString(16).padLeft(16, '0').substring(0, 16);
  }

  /// Update token when user logs in
  Future<void> onUserLogin(String userId) async {
    Log.d(_tag, 'onUserLogin: Called for user $userId');

    // Always get fresh token on login to handle race conditions
    try {
      final token = await _messaging.getToken();
      if (_isValidFcmToken(token)) {
        _currentToken = token;
        await _saveTokenToFirestore(token!);
        Log.d(_tag, 'onUserLogin: Fresh token saved');
      } else if (_currentToken != null) {
        // Fall back to cached token if fresh fetch fails
        await _saveTokenToFirestore(_currentToken!);
        Log.d(_tag, 'onUserLogin: Cached token saved');
      } else {
        Log.w(_tag, 'onUserLogin: No valid token available');
      }
    } catch (e, stack) {
      Log.e(_tag, 'onUserLogin: Failed to get/save token', e, stack);
      // Still try to save cached token if available
      if (_currentToken != null) {
        await _saveTokenToFirestore(_currentToken!);
      }
    }
  }

  /// Remove token when user logs out
  Future<void> onUserLogout() async {
    Log.d(_tag, 'onUserLogout: Called');
    if (_currentToken == null) {
      Log.d(_tag, 'onUserLogout: No token to delete');
      return;
    }
    await _deleteTokenFromFirestore(_currentToken!);
  }

  /// Get current token
  String? get currentToken => _currentToken;

  /// Clear app badge count
  Future<void> _clearBadge() async {
    try {
      if (await FlutterAppBadger.isAppBadgeSupported()) {
        await FlutterAppBadger.removeBadge();
        Log.d(_tag, '_clearBadge: Badge cleared');
      }
    } catch (e) {
      Log.w(_tag, '_clearBadge: Failed to clear badge - $e');
    }
  }

  /// Public method to clear badge (call when app comes to foreground)
  Future<void> clearBadge() => _clearBadge();
}
