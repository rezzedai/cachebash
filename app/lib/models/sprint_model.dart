import 'package:cloud_firestore/cloud_firestore.dart';

/// Model representing a story within a sprint
/// In v2, stories are tasks with type: "sprint-story" in users/{uid}/tasks
class SprintStory {
  final String id;
  final String title;
  final String status;
  final int wave;
  final int progress;
  final String? currentAction;
  final List<String> dependencies;
  final String complexity;
  final String? model;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final int? duration;
  final bool addedDynamically;

  SprintStory({
    required this.id,
    required this.title,
    required this.status,
    required this.wave,
    required this.progress,
    this.currentAction,
    this.dependencies = const [],
    this.complexity = 'normal',
    this.model,
    this.startedAt,
    this.completedAt,
    this.duration,
    this.addedDynamically = false,
  });

  /// Create from v2 tasks collection (type: "sprint-story")
  factory SprintStory.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>?;
    final sprintData = data?['sprint'] as Map<String, dynamic>? ?? {};

    return SprintStory(
      id: sprintData['storyId'] ?? doc.id,
      title: data?['title'] ?? 'Untitled',
      status: sprintData['status'] ?? 'queued',
      wave: sprintData['wave'] ?? 1,
      progress: sprintData['progress'] ?? 0,
      currentAction: sprintData['currentAction'] as String?,
      dependencies: List<String>.from(sprintData['dependencies'] ?? []),
      complexity: sprintData['complexity'] ?? 'normal',
      model: sprintData['model'] as String?,
      startedAt: (data?['startedAt'] as Timestamp?)?.toDate(),
      completedAt: (data?['completedAt'] as Timestamp?)?.toDate(),
      duration: sprintData['duration'] as int?,
      addedDynamically: sprintData['addedDynamically'] ?? false,
    );
  }

  bool get isQueued => status == 'queued';
  bool get isActive => status == 'active';
  bool get isComplete => status == 'complete';
  bool get isFailed => status == 'failed';
  bool get isSkipped => status == 'skipped';
  bool get isDone => isComplete || isFailed || isSkipped;
  bool get isHighComplexity => complexity == 'high';
}

/// Model representing sprint configuration
class SprintConfig {
  final String orchestratorModel;
  final String subagentModel;
  final int maxConcurrent;

  SprintConfig({
    this.orchestratorModel = 'opus',
    this.subagentModel = 'sonnet',
    this.maxConcurrent = 3,
  });

  factory SprintConfig.fromMap(Map<String, dynamic>? data) {
    return SprintConfig(
      orchestratorModel: data?['orchestratorModel'] ?? 'opus',
      subagentModel: data?['subagentModel'] ?? 'sonnet',
      maxConcurrent: data?['maxConcurrent'] ?? 3,
    );
  }
}

/// Model representing sprint summary
class SprintSummary {
  final int completed;
  final int failed;
  final int skipped;
  final int duration;

  SprintSummary({
    this.completed = 0,
    this.failed = 0,
    this.skipped = 0,
    this.duration = 0,
  });

  factory SprintSummary.fromMap(Map<String, dynamic>? data) {
    return SprintSummary(
      completed: data?['completed'] ?? 0,
      failed: data?['failed'] ?? 0,
      skipped: data?['skipped'] ?? 0,
      duration: data?['duration'] ?? 0,
    );
  }

  int get total => completed + failed + skipped;
}

/// Model representing a sprint
/// In v2, sprints are tasks with type: "sprint" in users/{uid}/tasks
class SprintModel {
  final String id;
  final String projectName;
  final String branch;
  final String status;
  final int currentWave;
  final int totalWaves;
  final DateTime startedAt;
  final DateTime updatedAt;
  final DateTime? completedAt;
  final String? sessionId;
  final SprintConfig config;
  final SprintSummary? summary;

  SprintModel({
    required this.id,
    required this.projectName,
    required this.branch,
    required this.status,
    required this.currentWave,
    required this.totalWaves,
    required this.startedAt,
    required this.updatedAt,
    this.completedAt,
    this.sessionId,
    required this.config,
    this.summary,
  });

  /// Create from v2 tasks collection (type: "sprint")
  factory SprintModel.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>?;
    final sprintData = data?['sprint'] as Map<String, dynamic>? ?? {};
    final configData = sprintData['config'] as Map<String, dynamic>?;
    final summaryData = sprintData['summary'] as Map<String, dynamic>?;
    final lifecycleStatus = data?['status'] as String? ?? 'created';

    return SprintModel(
      id: doc.id,
      projectName: sprintData['projectName'] ?? 'Unknown Project',
      branch: sprintData['branch'] ?? 'main',
      status: _mapLifecycleStatus(lifecycleStatus),
      currentWave: sprintData['currentWave'] ?? 1,
      totalWaves: sprintData['totalWaves'] ?? 1,
      startedAt: (data?['startedAt'] as Timestamp?)?.toDate() ??
          (data?['createdAt'] as Timestamp?)?.toDate() ??
          DateTime.now(),
      updatedAt: (data?['completedAt'] as Timestamp?)?.toDate() ??
          (data?['createdAt'] as Timestamp?)?.toDate() ??
          DateTime.now(),
      completedAt: (data?['completedAt'] as Timestamp?)?.toDate(),
      sessionId: data?['sessionId'] as String?,
      config: SprintConfig.fromMap(configData),
      summary: summaryData != null
          ? SprintSummary.fromMap(summaryData)
          : null,
    );
  }

  /// Map lifecycle status to sprint display status
  static String _mapLifecycleStatus(String status) {
    switch (status) {
      case 'created':
      case 'active':
        return 'running';
      case 'blocked':
        return 'paused';
      case 'done':
      case 'derezzed':
        return 'complete';
      case 'failed':
        return 'error';
      default:
        return status;
    }
  }

  bool get isRunning => status == 'running';
  bool get isPaused => status == 'paused';
  bool get isComplete => status == 'complete';
  bool get isError => status == 'error';

  String get waveProgress => 'Wave $currentWave of $totalWaves';

  Duration get elapsed => DateTime.now().difference(startedAt);

  String get elapsedFormatted {
    final d = elapsed;
    if (d.inHours > 0) {
      return '${d.inHours}h ${d.inMinutes.remainder(60)}m';
    } else if (d.inMinutes > 0) {
      return '${d.inMinutes}m ${d.inSeconds.remainder(60)}s';
    } else {
      return '${d.inSeconds}s';
    }
  }
}
