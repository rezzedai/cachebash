import 'dart:io';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';

void _log(String message) {
  debugPrint('[FeedbackService] $message');
}

class FeedbackService {
  final FirebaseFunctions _functions = FirebaseFunctions.instance;

  Future<Map<String, dynamic>> submitFeedback({
    required String type,
    required String message,
    String? screenshotPath,
  }) async {
    _log('submitFeedback: type=$type, hasScreenshot=${screenshotPath != null}');

    String? screenshotUrl;

    // Upload screenshot if provided
    if (screenshotPath != null) {
      try {
        screenshotUrl = await _uploadScreenshot(screenshotPath);
        _log('Screenshot uploaded successfully: $screenshotUrl');
      } catch (e) {
        _log('Screenshot upload failed: $e');
        // Continue without screenshot rather than failing entirely
      }
    }

    // Get device info
    final packageInfo = await PackageInfo.fromPlatform();
    final platform = Platform.isIOS ? 'ios' : 'android';

    _log('Calling submitFeedback Cloud Function...');
    final callable = _functions.httpsCallable('submitFeedback');
    final result = await callable.call({
      'type': type,
      'message': message,
      'screenshotUrl': screenshotUrl,
      'appVersion': '${packageInfo.version} (${packageInfo.buildNumber})',
      'platform': platform,
      'osVersion': Platform.operatingSystemVersion,
      'deviceModel': Platform.localHostname,
    });

    _log('submitFeedback result: ${result.data}');
    return Map<String, dynamic>.from(result.data);
  }

  Future<String> _uploadScreenshot(String filePath) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw Exception('Not authenticated');

    final file = File(filePath);
    final fileName = 'feedback/${user.uid}/${DateTime.now().millisecondsSinceEpoch}.jpg';
    final ref = FirebaseStorage.instance.ref().child(fileName);

    _log('Uploading screenshot to: $fileName');
    await ref.putFile(file);
    final downloadUrl = await ref.getDownloadURL();
    return downloadUrl;
  }
}
