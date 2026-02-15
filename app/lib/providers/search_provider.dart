import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/question_model.dart';
import '../models/session_model.dart';
import '../models/task_model.dart';
import '../models/project_model.dart';
import '../services/encryption_service.dart';
import 'auth_provider.dart';

void _log(String message) {
  debugPrint('[SearchProvider] $message');
}

final _firestore = FirebaseFirestore.instance;

/// Search filter types
enum SearchFilter {
  all,
  questions,
  tasks,
  sessions,
  projects,
}

/// Search status filter
enum SearchStatusFilter {
  all,
  pending,
  completed,
  archived,
}

/// Combined search result with type information
class SearchResult {
  final String id;
  final String type; // 'question', 'task', 'session', 'project'
  final String title;
  final String? subtitle;
  final String status;
  final DateTime timestamp;
  final dynamic originalItem;

  SearchResult({
    required this.id,
    required this.type,
    required this.title,
    this.subtitle,
    required this.status,
    required this.timestamp,
    this.originalItem,
  });
}

/// State for search
class SearchState {
  final String query;
  final SearchFilter filter;
  final SearchStatusFilter statusFilter;
  final bool isLoading;
  final List<SearchResult> results;
  final String? error;

  const SearchState({
    this.query = '',
    this.filter = SearchFilter.all,
    this.statusFilter = SearchStatusFilter.all,
    this.isLoading = false,
    this.results = const [],
    this.error,
  });

  SearchState copyWith({
    String? query,
    SearchFilter? filter,
    SearchStatusFilter? statusFilter,
    bool? isLoading,
    List<SearchResult>? results,
    String? error,
  }) {
    return SearchState(
      query: query ?? this.query,
      filter: filter ?? this.filter,
      statusFilter: statusFilter ?? this.statusFilter,
      isLoading: isLoading ?? this.isLoading,
      results: results ?? this.results,
      error: error,
    );
  }
}

/// Search notifier with debounced queries
class SearchNotifier extends StateNotifier<SearchState> {
  final Ref _ref;
  DateTime? _lastQueryTime;
  static const _debounceMs = 300;

  SearchNotifier(this._ref) : super(const SearchState());

  void setQuery(String query) {
    state = state.copyWith(query: query);
    _debounceSearch();
  }

  void setFilter(SearchFilter filter) {
    state = state.copyWith(filter: filter);
    if (state.query.isNotEmpty) {
      _executeSearch();
    }
  }

  void setStatusFilter(SearchStatusFilter filter) {
    state = state.copyWith(statusFilter: filter);
    if (state.query.isNotEmpty) {
      _executeSearch();
    }
  }

  void clearSearch() {
    state = const SearchState();
  }

  void _debounceSearch() {
    final now = DateTime.now();
    _lastQueryTime = now;

    Future.delayed(const Duration(milliseconds: _debounceMs), () {
      if (_lastQueryTime == now && state.query.isNotEmpty) {
        _executeSearch();
      }
    });
  }

  Future<void> _executeSearch() async {
    final query = state.query.toLowerCase().trim();
    if (query.isEmpty) {
      state = state.copyWith(results: [], isLoading: false);
      return;
    }

    state = state.copyWith(isLoading: true, error: null);

    try {
      final user = _ref.read(currentUserProvider);
      if (user == null) {
        state = state.copyWith(isLoading: false, error: 'Not authenticated');
        return;
      }

      final encryptionService = _ref.read(encryptionServiceProvider);
      final results = <SearchResult>[];

      // Search in parallel based on filter
      final futures = <Future<List<SearchResult>>>[];

      if (state.filter == SearchFilter.all || state.filter == SearchFilter.questions) {
        futures.add(_searchQuestions(user.uid, query, encryptionService));
      }
      if (state.filter == SearchFilter.all || state.filter == SearchFilter.tasks) {
        futures.add(_searchTasks(user.uid, query, encryptionService));
      }
      if (state.filter == SearchFilter.all || state.filter == SearchFilter.sessions) {
        futures.add(_searchSessions(user.uid, query));
      }
      if (state.filter == SearchFilter.all || state.filter == SearchFilter.projects) {
        futures.add(_searchProjects(user.uid, query));
      }

      final allResults = await Future.wait(futures);
      for (final list in allResults) {
        results.addAll(list);
      }

      // Apply status filter
      final filteredResults = _applyStatusFilter(results);

      // Sort by timestamp (most recent first)
      filteredResults.sort((a, b) => b.timestamp.compareTo(a.timestamp));

      state = state.copyWith(results: filteredResults, isLoading: false);
    } catch (e, stack) {
      _log('Search error: $e');
      _log('Stack: $stack');
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }

  List<SearchResult> _applyStatusFilter(List<SearchResult> results) {
    if (state.statusFilter == SearchStatusFilter.all) {
      return results;
    }

    return results.where((r) {
      switch (state.statusFilter) {
        case SearchStatusFilter.pending:
          return r.status == 'pending' || r.status == 'working' || r.status == 'blocked';
        case SearchStatusFilter.completed:
          return r.status == 'answered' || r.status == 'complete' || r.status == 'completed';
        case SearchStatusFilter.archived:
          return r.status == 'archived' || r.status == 'expired' || r.status == 'cancelled';
        case SearchStatusFilter.all:
          return true;
      }
    }).toList();
  }

  Future<List<SearchResult>> _searchQuestions(
    String userId,
    String query,
    EncryptionService encryptionService,
  ) async {
    _log('Searching questions for: $query');

    // Fetch recent questions and filter client-side
    final snapshot = await _firestore
        .collection('users/$userId/questions')
        .where('deletedAt', isNull: true)
        .orderBy('createdAt', descending: true)
        .limit(100)
        .get();

    final results = <SearchResult>[];

    for (final doc in snapshot.docs) {
      final question = await QuestionModel.fromFirestoreDecrypted(doc, encryptionService);

      // Client-side text search
      final questionLower = question.question.toLowerCase();
      final contextLower = (question.context ?? '').toLowerCase();
      final responseLower = (question.response ?? '').toLowerCase();

      if (questionLower.contains(query) ||
          contextLower.contains(query) ||
          responseLower.contains(query)) {
        results.add(SearchResult(
          id: question.id,
          type: 'question',
          title: question.question,
          subtitle: question.context,
          status: question.isArchived ? 'archived' : question.status,
          timestamp: question.createdAt,
          originalItem: question,
        ));
      }
    }

    _log('Found ${results.length} questions');
    return results;
  }

  Future<List<SearchResult>> _searchTasks(
    String userId,
    String query,
    EncryptionService encryptionService,
  ) async {
    _log('Searching tasks for: $query');

    final snapshot = await _firestore
        .collection('users/$userId/tasks')
        .orderBy('createdAt', descending: true)
        .limit(100)
        .get();

    final results = <SearchResult>[];

    for (final doc in snapshot.docs) {
      final task = await TaskModel.fromFirestoreDecrypted(doc, encryptionService);

      final titleLower = task.title.toLowerCase();
      final instructionsLower = task.instructions.toLowerCase();

      if (titleLower.contains(query) || instructionsLower.contains(query)) {
        results.add(SearchResult(
          id: task.id,
          type: 'task',
          title: task.title,
          subtitle: task.instructions,
          status: task.status.value,
          timestamp: task.createdAt,
          originalItem: task,
        ));
      }
    }

    _log('Found ${results.length} tasks');
    return results;
  }

  Future<List<SearchResult>> _searchSessions(String userId, String query) async {
    _log('Searching sessions for: $query');

    final snapshot = await _firestore
        .collection('users/$userId/sessions')
        .orderBy('lastUpdate', descending: true)
        .limit(100)
        .get();

    final results = <SearchResult>[];

    for (final doc in snapshot.docs) {
      final session = SessionModel.fromFirestore(doc);

      final nameLower = session.name.toLowerCase();
      final statusLower = session.status.toLowerCase();

      if (nameLower.contains(query) || statusLower.contains(query)) {
        results.add(SearchResult(
          id: session.id,
          type: 'session',
          title: session.name,
          subtitle: session.status,
          status: session.isArchived ? 'archived' : session.displayState,
          timestamp: session.lastUpdate,
          originalItem: session,
        ));
      }
    }

    _log('Found ${results.length} sessions');
    return results;
  }

  Future<List<SearchResult>> _searchProjects(String userId, String query) async {
    _log('Searching projects for: $query');

    final snapshot = await _firestore
        .collection('users/$userId/projects')
        .where('deletedAt', isNull: true)
        .orderBy('createdAt', descending: false)
        .limit(50)
        .get();

    final results = <SearchResult>[];

    for (final doc in snapshot.docs) {
      final project = ProjectModel.fromFirestore(doc);

      final nameLower = project.name.toLowerCase();

      if (nameLower.contains(query)) {
        results.add(SearchResult(
          id: project.id,
          type: 'project',
          title: project.name,
          subtitle: '${project.questionCount} questions',
          status: project.isDefault ? 'default' : 'active',
          timestamp: project.createdAt,
          originalItem: project,
        ));
      }
    }

    _log('Found ${results.length} projects');
    return results;
  }
}

/// Provider for search state
final searchProvider = StateNotifierProvider<SearchNotifier, SearchState>((ref) {
  return SearchNotifier(ref);
});

/// Grouped search results by type
final groupedSearchResultsProvider = Provider<Map<String, List<SearchResult>>>((ref) {
  final searchState = ref.watch(searchProvider);

  final grouped = <String, List<SearchResult>>{};

  for (final result in searchState.results) {
    grouped.putIfAbsent(result.type, () => []).add(result);
  }

  return grouped;
});
