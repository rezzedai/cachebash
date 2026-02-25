import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/feedback_model.dart';
import 'auth_provider.dart';

void _log(String message) {
  debugPrint('[FeedbackProvider] $message');
}

final firestore = FirebaseFirestore.instance;

/// Stream provider for user's feedback submissions
final feedbackHistoryProvider = StreamProvider<List<FeedbackModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  if (user == null) return Stream.value([]);

  _log('feedbackHistoryProvider: Setting up stream for user ${user.uid}');
  return firestore
      .collection('tenants/${user.uid}/feedback')
      .orderBy('createdAt', descending: true)
      .limit(50)
      .snapshots()
      .map((snapshot) {
        _log('feedbackHistoryProvider: Got ${snapshot.docs.length} docs');
        return snapshot.docs.map((doc) => FeedbackModel.fromFirestore(doc)).toList();
      });
});
