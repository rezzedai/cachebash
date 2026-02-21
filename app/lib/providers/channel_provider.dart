import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/message_model.dart';
import '../models/session_model.dart';
import '../theme/program_colors.dart';
import 'messages_provider.dart';
import 'sessions_provider.dart';

/// Represents a single channel (one per program) with aggregated data
class ChannelData {
  final String programId;
  final ProgramMeta meta;
  final List<MessageModel> messages;
  final SessionModel? activeSession;
  final int unreadCount;
  final DateTime? lastActivity;

  const ChannelData({
    required this.programId,
    required this.meta,
    required this.messages,
    this.activeSession,
    this.unreadCount = 0,
    this.lastActivity,
  });

  /// Whether this channel has pending questions needing response
  bool get hasPendingQuestions => messages.any((m) => m.needsResponse);

  /// Count of pending questions
  int get pendingQuestionCount => messages.where((m) => m.needsResponse).length;

  /// Whether the program has an active (non-stale, non-archived) session
  bool get hasActiveSession => activeSession != null && activeSession!.isActive;

  /// Whether the program is blocked
  bool get isBlocked => activeSession?.isBlocked ?? false;

  /// Program state string for display
  String get displayState {
    if (activeSession == null) return 'offline';
    return activeSession!.displayState;
  }
}

/// Provides a list of all channels, sorted by activity priority
final channelListProvider = Provider<AsyncValue<List<ChannelData>>>((ref) {
  final messagesAsync = ref.watch(activeMessagesProvider);
  final sessionsAsync = ref.watch(activeSessionsProvider);

  // Combine async states
  if (messagesAsync.isLoading || sessionsAsync.isLoading) {
    return const AsyncValue.loading();
  }

  final messages = messagesAsync.valueOrNull ?? [];
  final sessions = sessionsAsync.valueOrNull ?? [];

  // Collect all program IDs from sessions
  final programIds = <String>{};
  for (final session in sessions) {
    if (session.programId != null) {
      programIds.add(session.programId!.toLowerCase());
    }
  }

  // Always include all known programs so channels exist even without activity
  programIds.addAll(ProgramRegistry.knownIds);

  // Build channel data for each program
  final channels = programIds.map((id) {
    final meta = ProgramRegistry.get(id);

    // Find active session for this program
    final programSessions = sessions
        .where((s) => s.programId?.toLowerCase() == id)
        .toList()
      ..sort((a, b) => b.lastUpdate.compareTo(a.lastUpdate));
    final activeSession = programSessions.isNotEmpty ? programSessions.first : null;

    // Filter messages relevant to this program
    // Messages are associated via sessionId which contains the program name
    final programMessages = messages.where((m) {
      final sid = m.sessionId?.toLowerCase() ?? '';
      return sid.contains(id);
    }).toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));

    // Calculate last activity
    DateTime? lastActivity;
    if (programMessages.isNotEmpty) {
      lastActivity = programMessages.first.createdAt;
    }
    if (activeSession != null) {
      final sessionTime = activeSession.lastUpdate;
      if (lastActivity == null || sessionTime.isAfter(lastActivity)) {
        lastActivity = sessionTime;
      }
    }

    return ChannelData(
      programId: id,
      meta: meta,
      messages: programMessages,
      activeSession: activeSession,
      unreadCount: programMessages.where((m) => m.isPending).length,
      lastActivity: lastActivity,
    );
  }).toList();

  // Sort: pending questions first, then active sessions, then by last activity
  channels.sort((a, b) {
    // Pending questions always on top
    if (a.hasPendingQuestions && !b.hasPendingQuestions) return -1;
    if (!a.hasPendingQuestions && b.hasPendingQuestions) return 1;

    // Active sessions next
    if (a.hasActiveSession && !b.hasActiveSession) return -1;
    if (!a.hasActiveSession && b.hasActiveSession) return 1;

    // Then by last activity
    final aTime = a.lastActivity ?? DateTime(2000);
    final bTime = b.lastActivity ?? DateTime(2000);
    return bTime.compareTo(aTime);
  });

  return AsyncValue.data(channels);
});

/// Provides channel data for a specific program
final channelDetailProvider = Provider.family<AsyncValue<ChannelData>, String>((ref, programId) {
  final channelList = ref.watch(channelListProvider);
  return channelList.when(
    data: (channels) {
      final channel = channels.firstWhere(
        (c) => c.programId == programId.toLowerCase(),
        orElse: () => ChannelData(
          programId: programId.toLowerCase(),
          meta: ProgramRegistry.get(programId),
          messages: [],
        ),
      );
      return AsyncValue.data(channel);
    },
    loading: () => const AsyncValue.loading(),
    error: (e, st) => AsyncValue.error(e, st),
  );
});
