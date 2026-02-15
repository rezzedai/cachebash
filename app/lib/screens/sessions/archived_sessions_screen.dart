import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/auth_provider.dart';
import '../../providers/sessions_provider.dart';
import '../../services/haptic_service.dart';
import '../../widgets/session_card.dart';

class ArchivedSessionsScreen extends ConsumerWidget {
  const ArchivedSessionsScreen({super.key});

  Future<void> _unarchiveSession(
    BuildContext context,
    WidgetRef ref,
    String sessionId,
  ) async {
    final user = ref.read(currentUserProvider);
    if (user == null) return;

    try {
      await ref.read(sessionsServiceProvider).unarchiveSession(
            userId: user.uid,
            sessionId: sessionId,
          );
      HapticService.success();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Session restored')),
        );
      }
    } catch (e) {
      HapticService.error();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  Future<void> _deleteSession(
    BuildContext context,
    WidgetRef ref,
    String sessionId,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Session?'),
        content: const Text(
          'This will permanently delete this session. This action cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              HapticService.medium();
              Navigator.pop(context, true);
            },
            style: TextButton.styleFrom(
              foregroundColor: Theme.of(context).colorScheme.error,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    final user = ref.read(currentUserProvider);
    if (user == null) return;

    try {
      await ref.read(sessionsServiceProvider).deleteSession(
            userId: user.uid,
            sessionId: sessionId,
          );
      HapticService.success();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Session deleted')),
        );
      }
    } catch (e) {
      HapticService.error();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final archivedSessions = ref.watch(archivedSessionsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Archived Sessions'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            HapticService.light();
            context.go('/sessions');
          },
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(archivedSessionsProvider);
        },
        child: archivedSessions.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, stack) => Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text('Error: $error'),
            ),
          ),
          data: (sessions) {
            if (sessions.isEmpty) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.archive,
                      size: 64,
                      color: Theme.of(context).colorScheme.outline,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'No archived sessions',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Swipe sessions to archive them',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color:
                                Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                    ),
                  ],
                ),
              );
            }

            return ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: sessions.length,
              itemBuilder: (context, index) {
                final session = sessions[index];
                return Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Stack(
                    children: [
                      SessionCard(
                        session: session,
                        onTap: () {
                          HapticService.light();
                          context.push('/sessions/${session.id}');
                        },
                        onUnarchive: () =>
                            _unarchiveSession(context, ref, session.id),
                      ),
                      Positioned(
                        top: 8,
                        right: 8,
                        child: PopupMenuButton<String>(
                          icon: Icon(
                            Icons.more_vert,
                            color:
                                Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                          onSelected: (value) {
                            if (value == 'restore') {
                              _unarchiveSession(context, ref, session.id);
                            } else if (value == 'delete') {
                              _deleteSession(context, ref, session.id);
                            }
                          },
                          itemBuilder: (context) => [
                            const PopupMenuItem(
                              value: 'restore',
                              child: Row(
                                children: [
                                  Icon(Icons.unarchive),
                                  SizedBox(width: 12),
                                  Text('Restore'),
                                ],
                              ),
                            ),
                            PopupMenuItem(
                              value: 'delete',
                              child: Row(
                                children: [
                                  Icon(
                                    Icons.delete,
                                    color: Theme.of(context).colorScheme.error,
                                  ),
                                  const SizedBox(width: 12),
                                  Text(
                                    'Delete',
                                    style: TextStyle(
                                      color:
                                          Theme.of(context).colorScheme.error,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}
