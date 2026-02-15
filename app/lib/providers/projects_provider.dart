import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/project_model.dart';
import 'auth_provider.dart';

final firestore = FirebaseFirestore.instance;

void _log(String message) {
  debugPrint('[ProjectsProvider] $message');
}

/// Stream provider for all projects (excluding deleted)
final projectsProvider = StreamProvider<List<ProjectModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  _log('projectsProvider: user=${user?.uid}');
  if (user == null) {
    _log('projectsProvider: No user, returning empty');
    return Stream.value([]);
  }

  _log('projectsProvider: Setting up stream for user ${user.uid}');
  return firestore
      .collection('users/${user.uid}/projects')
      .where('deletedAt', isNull: true)
      .orderBy('createdAt', descending: false)
      .snapshots()
      .map((snapshot) {
        _log('projectsProvider: Got ${snapshot.docs.length} docs');
        return snapshot.docs.map((doc) => ProjectModel.fromFirestore(doc)).toList();
      })
      .handleError((error, stackTrace) {
        _log('projectsProvider ERROR: $error');
        _log('projectsProvider STACK: $stackTrace');
        throw error;
      });
});

/// Provider for a single project by ID
final projectProvider =
    StreamProvider.family<ProjectModel?, String>((ref, projectId) {
  final user = ref.watch(currentUserProvider);
  _log('projectProvider: user=${user?.uid}, projectId=$projectId');
  if (user == null) {
    _log('projectProvider: No user, returning null');
    return Stream.value(null);
  }

  // Handle uncategorized specially
  if (projectId == '_uncategorized') {
    _log('projectProvider: Returning uncategorized');
    return Stream.value(ProjectModel.uncategorized);
  }

  _log('projectProvider: Setting up stream for project $projectId');
  return firestore
      .doc('users/${user.uid}/projects/$projectId')
      .snapshots()
      .map((doc) {
        _log('projectProvider: Got doc exists=${doc.exists}');
        return doc.exists ? ProjectModel.fromFirestore(doc) : null;
      })
      .handleError((error, stackTrace) {
        _log('projectProvider ERROR: $error');
        _log('projectProvider STACK: $stackTrace');
        throw error;
      });
});

/// Provider for projects with question counts
final projectsWithCountsProvider =
    StreamProvider<List<ProjectModel>>((ref) async* {
  final user = ref.watch(currentUserProvider);
  _log('projectsWithCountsProvider: user=${user?.uid}');
  if (user == null) {
    _log('projectsWithCountsProvider: No user, returning empty');
    yield [];
    return;
  }

  _log('projectsWithCountsProvider: Setting up stream for user ${user.uid}');
  // Get projects stream
  final projectsStream = firestore
      .collection('users/${user.uid}/projects')
      .where('deletedAt', isNull: true)
      .orderBy('createdAt', descending: false)
      .snapshots();

  try {
    await for (final snapshot in projectsStream) {
      _log('projectsWithCountsProvider: Got ${snapshot.docs.length} project docs');
      final projects =
          snapshot.docs.map((doc) => ProjectModel.fromFirestore(doc)).toList();

      // Count uncategorized questions
      _log('projectsWithCountsProvider: Counting uncategorized questions...');
      try {
        final uncategorizedSnapshot = await firestore
            .collection('users/${user.uid}/tasks')
            .where('type', isEqualTo: 'question')
            .where('archived', isEqualTo: false)
            .where('projectId', isNull: true)
            .count()
            .get();

        final uncategorizedCount = uncategorizedSnapshot.count ?? 0;
        _log('projectsWithCountsProvider: Uncategorized count = $uncategorizedCount');

        // Add uncategorized as first item if there are any
        final result = <ProjectModel>[];
        if (uncategorizedCount > 0) {
          result.add(ProjectModel.uncategorized.copyWith(
            questionCount: uncategorizedCount,
          ));
        }
        result.addAll(projects);

        _log('projectsWithCountsProvider: Yielding ${result.length} projects');
        yield result;
      } catch (e, stackTrace) {
        _log('projectsWithCountsProvider ERROR counting uncategorized: $e');
        _log('projectsWithCountsProvider STACK: $stackTrace');
        // Yield projects without counts if counting fails
        yield projects;
      }
    }
  } catch (e, stackTrace) {
    _log('projectsWithCountsProvider ERROR: $e');
    _log('projectsWithCountsProvider STACK: $stackTrace');
    rethrow;
  }
});

/// Provider for efficient project name lookups by ID
final projectNameMapProvider = Provider<Map<String, String>>((ref) {
  final projectsAsync = ref.watch(projectsProvider);
  return projectsAsync.maybeWhen(
    data: (projects) => {for (final p in projects) p.id: p.name},
    orElse: () => {},
  );
});

/// Service for managing projects
class ProjectsService {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  /// Create a new project
  Future<String> createProject({
    required String userId,
    required String name,
  }) async {
    final docRef = await _firestore.collection('users/$userId/projects').add({
      'name': name,
      'createdAt': FieldValue.serverTimestamp(),
      'questionCount': 0,
      'isDefault': false,
      'deletedAt': null,
    });
    return docRef.id;
  }

  /// Rename a project
  Future<void> renameProject({
    required String userId,
    required String projectId,
    required String name,
  }) async {
    await _firestore.doc('users/$userId/projects/$projectId').update({
      'name': name,
    });
  }

  /// Soft delete a project (archives its questions)
  Future<void> deleteProject({
    required String userId,
    required String projectId,
  }) async {
    // First, archive all questions in this project
    final questions = await _firestore
        .collection('users/$userId/tasks')
        .where('type', isEqualTo: 'question')
        .where('projectId', isEqualTo: projectId)
        .get();

    final batch = _firestore.batch();
    for (final doc in questions.docs) {
      batch.update(doc.reference, {'archived': true});
    }

    // Then soft delete the project
    batch.update(_firestore.doc('users/$userId/projects/$projectId'), {
      'deletedAt': FieldValue.serverTimestamp(),
    });

    await batch.commit();
  }

  /// Set a project as the default for new questions
  Future<void> setDefaultProject({
    required String userId,
    required String? projectId,
  }) async {
    // Clear existing default
    final existingDefaults = await _firestore
        .collection('users/$userId/projects')
        .where('isDefault', isEqualTo: true)
        .get();

    final batch = _firestore.batch();
    for (final doc in existingDefaults.docs) {
      batch.update(doc.reference, {'isDefault': false});
    }

    // Set new default if specified
    if (projectId != null && projectId != '_uncategorized') {
      batch.update(_firestore.doc('users/$userId/projects/$projectId'), {
        'isDefault': true,
      });
    }

    await batch.commit();
  }
}

final projectsServiceProvider = Provider<ProjectsService>((ref) {
  return ProjectsService();
});
