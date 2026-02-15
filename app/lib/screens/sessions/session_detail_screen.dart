import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/session_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/sessions_provider.dart';
import '../../services/haptic_service.dart';

class SessionDetailScreen extends ConsumerStatefulWidget {
  final String sessionId;

  const SessionDetailScreen({super.key, required this.sessionId});

  @override
  ConsumerState<SessionDetailScreen> createState() => _SessionDetailScreenState();
}

class _SessionDetailScreenState extends ConsumerState<SessionDetailScreen> {
  final _messageController = TextEditingController();
  bool _isSending = false;
  bool _isRequestingStatus = false;
  DateTime? _lastStatusRequest;

  @override
  void dispose() {
    _messageController.dispose();
    super.dispose();
  }

  Future<void> _sendMessage() async {
    final message = _messageController.text.trim();
    if (message.isEmpty) return;

    final user = ref.read(currentUserProvider);
    if (user == null) return;

    setState(() => _isSending = true);
    HapticService.medium();

    try {
      await ref.read(sessionsServiceProvider).sendInterrupt(
            userId: user.uid,
            sessionId: widget.sessionId,
            message: message,
          );

      if (mounted) {
        _messageController.clear();
        HapticService.success();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Message sent to Claude')),
        );
      }
    } catch (e) {
      if (mounted) {
        HapticService.error();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSending = false);
      }
    }
  }

  Future<void> _requestStatusUpdate() async {
    final user = ref.read(currentUserProvider);
    if (user == null) return;

    setState(() => _isRequestingStatus = true);
    HapticService.medium();

    try {
      await ref.read(sessionsServiceProvider).sendInterrupt(
            userId: user.uid,
            sessionId: widget.sessionId,
            message: 'Please provide a status update on what you\'re currently working on.',
          );

      if (mounted) {
        setState(() {
          _lastStatusRequest = DateTime.now();
          _isRequestingStatus = false;
        });
        HapticService.success();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Status update requested')),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isRequestingStatus = false);
        HapticService.error();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final sessionAsync = ref.watch(sessionProvider(widget.sessionId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Session Details'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            HapticService.light();
            if (context.canPop()) {
              context.pop();
            } else {
              context.go('/sessions');
            }
          },
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Request Status Update',
            onPressed: _requestStatusUpdate,
          ),
        ],
      ),
      body: sessionAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(child: Text('Error: $error')),
        data: (session) {
          if (session == null) {
            return const Center(child: Text('Session not found'));
          }

          return Column(
            children: [
              // Session info
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // State indicator and name
                      Row(
                        children: [
                          _buildStateChip(context, session),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              session.name,
                              style: Theme.of(context).textTheme.headlineSmall,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),

                      // Status
                      if (session.status.isNotEmpty) ...[
                        Text(
                          'Current Status',
                          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                                color: Theme.of(context).colorScheme.primary,
                              ),
                        ),
                        const SizedBox(height: 8),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: Theme.of(context).colorScheme.surfaceContainerLow,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                session.status,
                                style: Theme.of(context).textTheme.bodyLarge,
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'Updated ${_formatDateTime(session.lastUpdate)}',
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                                    ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 24),
                      ],

                      // Progress
                      if (session.progress != null) ...[
                        Text(
                          'Progress',
                          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                                color: Theme.of(context).colorScheme.primary,
                              ),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(4),
                                child: LinearProgressIndicator(
                                  value: session.progress! / 100,
                                  minHeight: 8,
                                  backgroundColor:
                                      Theme.of(context).colorScheme.surfaceContainerHighest,
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Text(
                              '${session.progress}%',
                              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                    fontWeight: FontWeight.bold,
                                  ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 24),
                      ],

                      // Session ID (for debugging/MCP operations)
                      Text(
                        'Session ID',
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                              color: Theme.of(context).colorScheme.primary,
                            ),
                      ),
                      const SizedBox(height: 8),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Theme.of(context).colorScheme.surfaceContainerLow,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          children: [
                            Icon(
                              Icons.fingerprint,
                              size: 16,
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                widget.sessionId,
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                      fontFamily: 'monospace',
                                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                                    ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 24),

                      // Get Status button (prominent)
                      if (session.isWorking || session.isBlocked)
                        FilledButton.tonal(
                          onPressed: _isRequestingStatus ? null : _requestStatusUpdate,
                          style: FilledButton.styleFrom(
                            minimumSize: const Size(double.infinity, 48),
                          ),
                          child: _isRequestingStatus
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    const Icon(Icons.sync),
                                    const SizedBox(width: 8),
                                    Text(_lastStatusRequest != null
                                        ? 'Requested ${_formatDateTime(_lastStatusRequest!)}'
                                        : 'Get Status Update'),
                                  ],
                                ),
                        ),
                      const SizedBox(height: 16),

                      // Info about messaging
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Row(
                            children: [
                              Icon(
                                Icons.info_outline,
                                color: Theme.of(context).colorScheme.primary,
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Text(
                                  'Send a message to interrupt Claude and provide new instructions or ask a question.',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 24),

                      // Status History
                      Text(
                        'Status History',
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                              color: Theme.of(context).colorScheme.primary,
                            ),
                      ),
                      const SizedBox(height: 8),
                      _buildStatusHistory(),
                    ],
                  ),
                ),
              ),

              // Message input
              if (session.isWorking || session.isBlocked)
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surface,
                    border: Border(
                      top: BorderSide(
                        color: Theme.of(context).colorScheme.outlineVariant,
                      ),
                    ),
                  ),
                  child: SafeArea(
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _messageController,
                            decoration: InputDecoration(
                              hintText: 'Send a message to Claude...',
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(24),
                              ),
                              contentPadding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 12,
                              ),
                            ),
                            maxLines: null,
                            textInputAction: TextInputAction.send,
                            onSubmitted: (_) => _sendMessage(),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton.filled(
                          onPressed: _isSending ? null : _sendMessage,
                          icon: _isSending
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.send),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildStateChip(BuildContext context, SessionModel session) {
    Color color;
    IconData icon;
    String label;

    // Use displayState to account for staleness/archived status
    switch (session.displayState) {
      case 'working':
        color = Colors.green;
        icon = Icons.play_circle;
        label = 'Working';
        break;
      case 'blocked':
        color = Colors.orange;
        icon = Icons.pause_circle;
        label = 'Blocked';
        break;
      case 'pinned':
        color = Colors.blue;
        icon = Icons.push_pin;
        label = 'Pinned';
        break;
      case 'complete':
        color = Colors.grey;
        icon = Icons.check_circle;
        label = 'Complete';
        break;
      case 'inactive':
        color = Colors.orange.shade300;
        icon = Icons.access_time;
        label = 'Inactive';
        break;
      case 'archived':
        color = Colors.grey.shade400;
        icon = Icons.archive;
        label = 'Archived';
        break;
      default:
        color = Colors.grey;
        icon = Icons.circle;
        label = 'Unknown';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color.withAlpha(51),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withAlpha(128)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 16),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.w500,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  String _formatDateTime(DateTime time) {
    final now = DateTime.now();
    final diff = now.difference(time);

    if (diff.inMinutes < 1) {
      return 'Just now';
    } else if (diff.inMinutes < 60) {
      return '${diff.inMinutes} minute${diff.inMinutes == 1 ? '' : 's'} ago';
    } else if (diff.inHours < 24) {
      return '${diff.inHours} hour${diff.inHours == 1 ? '' : 's'} ago';
    } else {
      return '${time.month}/${time.day}/${time.year} at ${time.hour}:${time.minute.toString().padLeft(2, '0')}';
    }
  }

  Widget _buildStatusHistory() {
    final updatesAsync = ref.watch(sessionUpdatesProvider(widget.sessionId));

    return updatesAsync.when(
      loading: () => const Center(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: CircularProgressIndicator(),
        ),
      ),
      error: (error, stack) => Padding(
        padding: const EdgeInsets.all(16),
        child: Text('Error loading history: $error'),
      ),
      data: (updates) {
        if (updates.isEmpty) {
          return Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerLow,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.history,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: 12),
                Text(
                  'No status history yet',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
              ],
            ),
          );
        }

        return Column(
          children: updates.map((update) => _buildUpdateItem(update)).toList(),
        );
      },
    );
  }

  void _showStatusDetailSheet(StatusUpdate update) {
    HapticService.light();

    Color stateColor;
    IconData stateIcon;
    String stateLabel;

    switch (update.state) {
      case 'working':
        stateColor = Colors.green;
        stateIcon = Icons.play_circle;
        stateLabel = 'Working';
        break;
      case 'blocked':
        stateColor = Colors.orange;
        stateIcon = Icons.pause_circle;
        stateLabel = 'Blocked';
        break;
      case 'pinned':
        stateColor = Colors.blue;
        stateIcon = Icons.push_pin;
        stateLabel = 'Pinned';
        break;
      case 'complete':
        stateColor = Colors.grey;
        stateIcon = Icons.check_circle;
        stateLabel = 'Complete';
        break;
      default:
        stateColor = Colors.grey;
        stateIcon = Icons.circle;
        stateLabel = update.state;
    }

    // Format date and time manually
    final weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    final months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    final d = update.createdAt;
    final dateStr = '${weekdays[d.weekday - 1]}, ${months[d.month - 1]} ${d.day}, ${d.year}';
    final hour = d.hour > 12 ? d.hour - 12 : (d.hour == 0 ? 12 : d.hour);
    final amPm = d.hour >= 12 ? 'PM' : 'AM';
    final timeStr = '$hour:${d.minute.toString().padLeft(2, '0')}:${d.second.toString().padLeft(2, '0')} $amPm';

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.5,
        minChildSize: 0.3,
        maxChildSize: 0.8,
        expand: false,
        builder: (context, scrollController) => SingleChildScrollView(
          controller: scrollController,
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Drag handle
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.outline,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 24),

              // State badge
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: stateColor.withAlpha(51),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: stateColor.withAlpha(128)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(stateIcon, color: stateColor, size: 16),
                    const SizedBox(width: 4),
                    Text(
                      stateLabel,
                      style: TextStyle(
                        color: stateColor,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    if (update.progress != null) ...[
                      const SizedBox(width: 8),
                      Text(
                        '${update.progress}%',
                        style: TextStyle(
                          color: stateColor,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // Full status text
              Text(
                'Status',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: Theme.of(context).colorScheme.primary,
                    ),
              ),
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerLow,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: SelectableText(
                  update.status,
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
              ),
              const SizedBox(height: 16),

              // Exact timestamp
              Text(
                'Timestamp',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: Theme.of(context).colorScheme.primary,
                    ),
              ),
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerLow,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      dateStr,
                      style: Theme.of(context).textTheme.bodyLarge,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      timeStr,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              // Copy button
              OutlinedButton.icon(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: update.status));
                  HapticService.success();
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Status copied to clipboard')),
                  );
                  Navigator.pop(context);
                },
                icon: const Icon(Icons.copy),
                label: const Text('Copy Status Text'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(double.infinity, 48),
                ),
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildUpdateItem(StatusUpdate update) {
    Color stateColor;
    IconData stateIcon;

    switch (update.state) {
      case 'working':
        stateColor = Colors.green;
        stateIcon = Icons.play_circle;
        break;
      case 'blocked':
        stateColor = Colors.orange;
        stateIcon = Icons.pause_circle;
        break;
      case 'pinned':
        stateColor = Colors.blue;
        stateIcon = Icons.push_pin;
        break;
      case 'complete':
        stateColor = Colors.grey;
        stateIcon = Icons.check_circle;
        break;
      default:
        stateColor = Colors.grey;
        stateIcon = Icons.circle;
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: Theme.of(context).colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          onTap: () => _showStatusDetailSheet(update),
          borderRadius: BorderRadius.circular(8),
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(8),
              border: Border(
                left: BorderSide(
                  color: stateColor,
                  width: 3,
                ),
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(stateIcon, color: stateColor, size: 20),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        update.status,
                        style: Theme.of(context).textTheme.bodyMedium,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _formatDateTime(update.createdAt),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Icon(
                  Icons.chevron_right,
                  size: 20,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                if (update.progress != null) ...[
                  const SizedBox(width: 4),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.primaryContainer,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      '${update.progress}%',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: Theme.of(context).colorScheme.onPrimaryContainer,
                            fontWeight: FontWeight.w500,
                          ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
