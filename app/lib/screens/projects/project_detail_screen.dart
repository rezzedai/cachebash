import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/question_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/projects_provider.dart';
import '../../providers/questions_provider.dart';

void _log(String message) {
  debugPrint('[ProjectDetailScreen] $message');
}

class ProjectDetailScreen extends ConsumerWidget {
  final String projectId;

  const ProjectDetailScreen({super.key, required this.projectId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final projectAsync = ref.watch(projectProvider(projectId));
    final questionsAsync = ref.watch(questionsByProjectProvider(projectId));

    return Scaffold(
      appBar: AppBar(
        title: projectAsync.when(
          loading: () => const Text('Loading...'),
          error: (_, __) => const Text('Project'),
          data: (project) => Text(project?.name ?? 'Project'),
        ),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/projects'),
        ),
      ),
      body: questionsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) {
          _log('ERROR loading questions for project $projectId: $error');
          _log('STACK: $stack');
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.error_outline, size: 48, color: Colors.red),
                  const SizedBox(height: 16),
                  const Text('Error loading questions', style: TextStyle(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Text(
                    error.toString().length > 300 ? '${error.toString().substring(0, 300)}...' : error.toString(),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 12),
                  ),
                ],
              ),
            ),
          );
        },
        data: (questions) {
          if (questions.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.inbox_outlined,
                    size: 64,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'No questions in this project',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Questions with this project ID will appear here',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                  ),
                ],
              ),
            );
          }

          return ListView.builder(
            padding: const EdgeInsets.symmetric(vertical: 8),
            itemCount: questions.length,
            itemBuilder: (context, index) {
              final question = questions[index];
              return _QuestionListTile(
                question: question,
                onTap: () => context.push('/questions/${question.id}'),
                onArchive: () => _archiveQuestion(context, ref, question),
                onDelete: () => _deleteQuestion(context, ref, question),
              );
            },
          );
        },
      ),
    );
  }

  Future<void> _archiveQuestion(
      BuildContext context, WidgetRef ref, QuestionModel question) async {
    final user = ref.read(currentUserProvider);
    if (user != null) {
      await ref.read(questionsServiceProvider).archiveQuestion(
            userId: user.uid,
            questionId: question.id,
          );
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Question archived'),
            action: SnackBarAction(
              label: 'Undo',
              onPressed: () async {
                await ref.read(questionsServiceProvider).unarchiveQuestion(
                      userId: user.uid,
                      questionId: question.id,
                    );
              },
            ),
          ),
        );
      }
    }
  }

  Future<void> _deleteQuestion(
      BuildContext context, WidgetRef ref, QuestionModel question) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Question?'),
        content: const Text(
          'This question will be permanently deleted after 30 days.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      final user = ref.read(currentUserProvider);
      if (user != null) {
        await ref.read(questionsServiceProvider).deleteQuestion(
              userId: user.uid,
              questionId: question.id,
            );
      }
    }
  }
}

class _QuestionListTile extends StatelessWidget {
  final QuestionModel question;
  final VoidCallback onTap;
  final VoidCallback onArchive;
  final VoidCallback onDelete;

  const _QuestionListTile({
    required this.question,
    required this.onTap,
    required this.onArchive,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final statusColor = switch (question.status) {
      'pending' => Colors.orange,
      'answered' => Colors.green,
      'expired' => Colors.grey,
      _ => Colors.grey,
    };

    return ListTile(
      leading: CircleAvatar(
        backgroundColor: statusColor.withValues(alpha: 0.2),
        child: Icon(
          question.isPending
              ? Icons.help_outline
              : question.isAnswered
                  ? Icons.check_circle
                  : Icons.timer_off,
          color: statusColor,
        ),
      ),
      title: Text(
        question.question,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(
        _formatTimeAgo(question.createdAt),
        style: Theme.of(context).textTheme.bodySmall,
      ),
      trailing: PopupMenuButton<String>(
        onSelected: (value) {
          switch (value) {
            case 'archive':
              onArchive();
              break;
            case 'delete':
              onDelete();
              break;
          }
        },
        itemBuilder: (context) => [
          const PopupMenuItem(
            value: 'archive',
            child: Row(
              children: [
                Icon(Icons.archive),
                SizedBox(width: 8),
                Text('Archive'),
              ],
            ),
          ),
          PopupMenuItem(
            value: 'delete',
            child: Row(
              children: [
                const Icon(Icons.delete, color: Colors.red),
                const SizedBox(width: 8),
                Text('Delete', style: TextStyle(color: Colors.red.shade700)),
              ],
            ),
          ),
        ],
      ),
      onTap: onTap,
    );
  }

  String _formatTimeAgo(DateTime dateTime) {
    final now = DateTime.now();
    final difference = now.difference(dateTime);

    if (difference.inDays > 7) {
      return '${dateTime.month}/${dateTime.day}/${dateTime.year}';
    } else if (difference.inDays > 0) {
      return '${difference.inDays}d ago';
    } else if (difference.inHours > 0) {
      return '${difference.inHours}h ago';
    } else if (difference.inMinutes > 0) {
      return '${difference.inMinutes}m ago';
    } else {
      return 'Just now';
    }
  }
}
