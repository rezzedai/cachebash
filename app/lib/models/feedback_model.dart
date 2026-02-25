import 'package:cloud_firestore/cloud_firestore.dart';

class FeedbackModel {
  final String id;
  final String type;         // 'bug', 'feature_request', 'general'
  final String message;
  final String? screenshotUrl;
  final String? githubIssueUrl;
  final int? githubIssueNumber;
  final String status;       // 'submitted', 'issue_created', 'failed'
  final String platform;
  final String appVersion;
  final DateTime createdAt;

  FeedbackModel({
    required this.id,
    required this.type,
    required this.message,
    this.screenshotUrl,
    this.githubIssueUrl,
    this.githubIssueNumber,
    required this.status,
    required this.platform,
    required this.appVersion,
    required this.createdAt,
  });

  factory FeedbackModel.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return FeedbackModel(
      id: doc.id,
      type: data['type'] ?? 'general',
      message: data['message'] ?? '',
      screenshotUrl: data['screenshotUrl'],
      githubIssueUrl: data['githubIssueUrl'],
      githubIssueNumber: data['githubIssueNumber'],
      status: data['status'] ?? 'submitted',
      platform: data['platform'] ?? 'unknown',
      appVersion: data['appVersion'] ?? 'unknown',
      createdAt: (data['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
    );
  }
}
