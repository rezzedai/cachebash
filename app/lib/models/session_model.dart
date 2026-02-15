import 'package:cloud_firestore/cloud_firestore.dart';

/// Model representing a status update in session history
class StatusUpdate {
  final String id;
  final String status;
  final String state;
  final int? progress;
  final DateTime createdAt;

  StatusUpdate({
    required this.id,
    required this.status,
    required this.state,
    this.progress,
    required this.createdAt,
  });

  factory StatusUpdate.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>?;
    return StatusUpdate(
      id: doc.id,
      status: data?['status'] ?? '',
      state: data?['state'] ?? 'working',
      progress: data?['progress'] as int?,
      createdAt:
          (data?['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
    );
  }
}

/// Model representing a Claude Code session
/// Collection: users/{uid}/sessions (unchanged from v1)
class SessionModel {
  final String id;
  final String name;
  final String status;
  final String state;
  final int? progress;
  final DateTime lastUpdate;
  final bool archived;
  final DateTime? archivedAt;
  final String? projectName;
  final String? programId;

  /// Sessions are considered stale after this duration without updates
  static const staleDuration = Duration(minutes: 30);

  SessionModel({
    required this.id,
    required this.name,
    required this.status,
    required this.state,
    this.progress,
    required this.lastUpdate,
    this.archived = false,
    this.archivedAt,
    this.projectName,
    this.programId,
  });

  factory SessionModel.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>?;
    return SessionModel(
      id: doc.id,
      name: data?['name'] ?? 'Unknown Session',
      status: data?['status'] ?? '',
      state: data?['state'] ?? 'working',
      progress: data?['progress'] as int?,
      lastUpdate:
          (data?['lastUpdate'] as Timestamp?)?.toDate() ?? DateTime.now(),
      archived: data?['archived'] ?? false,
      archivedAt: (data?['archivedAt'] as Timestamp?)?.toDate(),
      projectName: data?['projectName'] as String?,
      programId: data?['programId'] as String?,
    );
  }

  bool get isWorking => state == 'working';
  bool get isBlocked => state == 'blocked';
  bool get isComplete => state == 'complete' || state == 'done';
  bool get isPinned => state == 'pinned';
  bool get isArchived => archived;

  bool get isStale {
    if (isComplete || isArchived) return false;
    return DateTime.now().difference(lastUpdate) > staleDuration;
  }

  bool get isActive {
    if (isComplete || isArchived || isStale) return false;
    return isWorking || isBlocked || isPinned;
  }

  String get displayState {
    if (isArchived) return 'archived';
    if (isStale && !isComplete) return 'inactive';
    return state;
  }
}
