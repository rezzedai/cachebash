import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'firebase_options.dart';
import 'services/fcm_service.dart';

void main() async {
  runZonedGuarded<Future<void>>(() async {
    WidgetsFlutterBinding.ensureInitialized();

    try {
      await Firebase.initializeApp(
        options: DefaultFirebaseOptions.currentPlatform,
      );

      // Register background message handler
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
      debugPrint('Firebase initialized successfully');

      // Initialize Crashlytics
      if (!kDebugMode) {
        FlutterError.onError = FirebaseCrashlytics.instance.recordFlutterFatalError;
        await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(true);
      } else {
        // Disable Crashlytics in debug mode
        await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(false);
      }
    } catch (e, st) {
      debugPrint('Firebase init error: $e\n$st');
    }

    // Note: FCM initialization happens in CacheBashApp after router is available

    runApp(
      const ProviderScope(
        child: CacheBashApp(),
      ),
    );
  }, (error, stack) {
    // Catch errors outside of Flutter framework
    if (!kDebugMode) {
      FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
    }
  });
}
