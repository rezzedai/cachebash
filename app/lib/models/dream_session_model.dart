import 'package:cloud_firestore/cloud_firestore.dart';

/// Model representing a dream session
/// In v2, dreams are tasks with type: "dream" in users/{uid}/tasks
class DreamSessionModel {
  final String id;
  final String type;
  final int version;
  final String status;
  final String agent;
  final String? taskId;
  final double budgetCapUsd;
  final double budgetConsumedUsd;
  final int timeoutHours;
  final String createdBy;
  final DateTime startedAt;
  final DateTime? endedAt;
  final String branch;
  final String? prUrl;
  final String? outcome;
  final String? morningReport;

  DreamSessionModel({
    required this.id,
    this.type = 'dream_session',
    this.version = 2,
    required this.status,
    required this.agent,
    this.taskId,
    required this.budgetCapUsd,
    this.budgetConsumedUsd = 0.0,
    this.timeoutHours = 4,
    this.createdBy = 'flynn',
    required this.startedAt,
    this.endedAt,
    required this.branch,
    this.prUrl,
    this.outcome,
    this.morningReport,
  });

  /// Create from v2 tasks collection (type: "dream")
  factory DreamSessionModel.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>?;
    final dreamData = data?['dream'] as Map<String, dynamic>? ?? {};
    final lifecycleStatus = data?['status'] as String? ?? 'created';

    return DreamSessionModel(
      id: doc.id,
      status: _mapLifecycleStatus(lifecycleStatus),
      agent: dreamData['agent'] ?? 'basher',
      taskId: data?['replyTo'] as String?,
      budgetCapUsd: (dreamData['budgetCapUsd'] as num?)?.toDouble() ?? 5.0,
      budgetConsumedUsd:
          (dreamData['budgetConsumedUsd'] as num?)?.toDouble() ?? 0.0,
      timeoutHours: dreamData['timeoutHours'] ?? 4,
      createdBy: data?['source'] ?? 'flynn',
      startedAt: (data?['startedAt'] as Timestamp?)?.toDate() ??
          (data?['createdAt'] as Timestamp?)?.toDate() ??
          DateTime.now(),
      endedAt: (data?['completedAt'] as Timestamp?)?.toDate(),
      branch: dreamData['branch'] ?? '',
      prUrl: dreamData['prUrl'] as String?,
      outcome: dreamData['outcome'] as String?,
      morningReport: dreamData['morningReport'] as String?,
    );
  }

  /// Map lifecycle status to dream-specific display status
  static String _mapLifecycleStatus(String status) {
    switch (status) {
      case 'created':
        return 'pending';
      case 'active':
        return 'active';
      case 'done':
        return 'completed';
      case 'failed':
        return 'failed';
      case 'derezzed':
        return 'killed';
      default:
        return status;
    }
  }

  // Status helpers
  bool get isPending => status == 'pending';
  bool get isActive => status == 'active';
  bool get isCompleted => status == 'completed';
  bool get isFailed => status == 'failed';
  bool get isKilled => status == 'killed';
  bool get isDone => isCompleted || isFailed || isKilled;
  bool get isRunning => isPending || isActive;

  // Budget helpers
  double get budgetRemaining => budgetCapUsd - budgetConsumedUsd;
  double get budgetPercentUsed =>
      budgetCapUsd > 0 ? (budgetConsumedUsd / budgetCapUsd * 100) : 0;

  // Time helpers
  Duration get elapsed => (endedAt ?? DateTime.now()).difference(startedAt);

  String get elapsedFormatted {
    final d = elapsed;
    if (d.inHours > 0) {
      return '${d.inHours}h ${d.inMinutes.remainder(60)}m';
    } else if (d.inMinutes > 0) {
      return '${d.inMinutes}m';
    } else {
      return '${d.inSeconds}s';
    }
  }

  String get statusDisplay {
    switch (status) {
      case 'pending':
        return 'Waiting for agent';
      case 'active':
        return 'Running';
      case 'completed':
        return 'Complete';
      case 'failed':
        return 'Failed';
      case 'killed':
        return 'Stopped';
      default:
        return status;
    }
  }
}
