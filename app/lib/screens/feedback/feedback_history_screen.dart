import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../models/feedback_model.dart';
import '../../providers/feedback_provider.dart';
import '../../services/haptic_service.dart';

void _log(String message) {
  debugPrint('[FeedbackHistoryScreen] $message');
}

class FeedbackHistoryScreen extends ConsumerWidget {
  const FeedbackHistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feedbackAsync = ref.watch(feedbackHistoryProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Feedback'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: feedbackAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) {
          _log('Error loading feedback: $error');
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.error_outline,
                    size: 48,
                    color: theme.colorScheme.error,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Failed to load feedback',
                    style: theme.textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    error.toString(),
                    style: theme.textTheme.bodySmall,
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          );
        },
        data: (feedbackList) {
          if (feedbackList.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.feedback_outlined,
                      size: 64,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'No feedback submitted yet',
                      style: theme.textTheme.titleMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Your feedback submissions will appear here.',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            );
          }

          return ListView.builder(
            itemCount: feedbackList.length,
            padding: const EdgeInsets.all(16),
            itemBuilder: (context, index) {
              final feedback = feedbackList[index];
              return _buildFeedbackCard(context, feedback);
            },
          );
        },
      ),
    );
  }

  Widget _buildFeedbackCard(BuildContext context, FeedbackModel feedback) {
    final theme = Theme.of(context);
    final typeConfig = _getTypeConfig(feedback.type);
    final statusConfig = _getStatusConfig(feedback.status);

    // Get first line of message
    final firstLine = feedback.message.split('\n').first;
    final displayMessage = firstLine.length > 80
        ? '${firstLine.substring(0, 80)}...'
        : firstLine;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: feedback.githubIssueUrl != null
            ? () {
                HapticService.light();
                _openGitHubIssue(feedback.githubIssueUrl!);
              }
            : null,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Type and status row
              Row(
                children: [
                  Icon(
                    typeConfig.$1,
                    size: 20,
                    color: typeConfig.$2,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      typeConfig.$3,
                      style: theme.textTheme.labelMedium?.copyWith(
                        color: typeConfig.$2,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: statusConfig.$2.withAlpha(30),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: statusConfig.$2.withAlpha(80),
                      ),
                    ),
                    child: Text(
                      statusConfig.$1,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: statusConfig.$2,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Message
              Text(
                displayMessage,
                style: theme.textTheme.bodyMedium,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 8),

              // Date and GitHub issue info
              Row(
                children: [
                  Icon(
                    Icons.access_time,
                    size: 14,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    _formatDate(feedback.createdAt),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  if (feedback.githubIssueNumber != null) ...[
                    const SizedBox(width: 12),
                    Icon(
                      Icons.tag,
                      size: 14,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      '#${feedback.githubIssueNumber}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                  if (feedback.githubIssueUrl != null) ...[
                    const Spacer(),
                    Icon(
                      Icons.open_in_new,
                      size: 14,
                      color: theme.colorScheme.primary,
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  (IconData, Color, String) _getTypeConfig(String type) {
    return switch (type) {
      'bug' => (Icons.bug_report, Colors.red, 'Bug Report'),
      'feature_request' => (Icons.lightbulb_outline, Colors.blue, 'Feature Request'),
      _ => (Icons.feedback, Colors.orange, 'General Feedback'),
    };
  }

  (String, Color) _getStatusConfig(String status) {
    return switch (status) {
      'issue_created' => ('Issue Created', Colors.green),
      'failed' => ('Failed', Colors.red),
      _ => ('Submitted', Colors.orange),
    };
  }

  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final diff = now.difference(date);

    if (diff.inMinutes < 1) {
      return 'just now';
    } else if (diff.inMinutes < 60) {
      return '${diff.inMinutes}m ago';
    } else if (diff.inHours < 24) {
      return '${diff.inHours}h ago';
    } else if (diff.inDays < 7) {
      return '${diff.inDays}d ago';
    } else {
      return '${date.month}/${date.day}/${date.year}';
    }
  }

  Future<void> _openGitHubIssue(String url) async {
    _log('Opening GitHub issue: $url');
    try {
      final uri = Uri.parse(url);
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      } else {
        _log('Cannot launch URL: $url');
      }
    } catch (e) {
      _log('Error launching URL: $e');
    }
  }
}
