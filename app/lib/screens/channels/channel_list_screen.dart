import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/channel_provider.dart';
import '../../models/message_model.dart';
import '../../widgets/program_avatar.dart';
import '../../widgets/shimmer_card.dart';
import '../../services/haptic_service.dart';

class ChannelListScreen extends ConsumerWidget {
  const ChannelListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channelsAsync = ref.watch(channelListProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Channels',
          style: TextStyle(
            fontFamily: 'monospace',
            fontWeight: FontWeight.bold,
            letterSpacing: 1.2,
          ),
        ),
        centerTitle: false,
      ),
      body: channelsAsync.when(
        loading: () => ListView.builder(
          padding: const EdgeInsets.symmetric(vertical: 8),
          itemCount: 6,
          itemBuilder: (context, index) => const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ShimmerSessionCard(),
          ),
        ),
        error: (error, stack) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline, size: 48, color: Theme.of(context).colorScheme.error),
              const SizedBox(height: 16),
              Text('Failed to load channels', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Text(error.toString(), style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
        data: (channels) {
          if (channels.isEmpty) {
            return const Center(
              child: Text('No channels available'),
            );
          }

          // Split into active and inactive
          final active = channels.where((c) => c.hasActiveSession || c.hasPendingQuestions || c.lastActivity != null).toList();
          final inactive = channels.where((c) => !c.hasActiveSession && !c.hasPendingQuestions && c.lastActivity == null).toList();

          return RefreshIndicator(
            onRefresh: () async {
              // Riverpod providers auto-refresh via Firestore listeners
              // This is a no-op but provides the pull-to-refresh gesture
              await Future.delayed(const Duration(milliseconds: 300));
            },
            child: ListView(
              padding: const EdgeInsets.symmetric(vertical: 8),
              children: [
                if (active.isNotEmpty) ...[
                  _SectionHeader(title: 'Active', count: active.length),
                  ...active.map((channel) => _ChannelTile(channel: channel)),
                ],
                if (inactive.isNotEmpty) ...[
                  _SectionHeader(title: 'All Programs', count: inactive.length),
                  ...inactive.map((channel) => _ChannelTile(channel: channel)),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  final int count;

  const _SectionHeader({required this.title, required this.count});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Row(
        children: [
          Text(
            title.toUpperCase(),
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: 11,
              fontWeight: FontWeight.bold,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
              letterSpacing: 1.5,
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              '$count',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.bold,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ChannelTile extends StatelessWidget {
  final ChannelData channel;

  const _ChannelTile({required this.channel});

  String _timeAgo(DateTime time) {
    final diff = DateTime.now().difference(time);
    if (diff.inMinutes < 1) return 'now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m';
    if (diff.inHours < 24) return '${diff.inHours}h';
    if (diff.inDays < 7) return '${diff.inDays}d';
    return '${(diff.inDays / 7).floor()}w';
  }

  @override
  Widget build(BuildContext context) {
    final lastMessage = channel.messages.isNotEmpty ? channel.messages.first : null;
    final hasUnread = channel.unreadCount > 0;

    return InkWell(
      onTap: () {
        HapticService.light();
        context.push('/channels/${channel.programId}');
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          children: [
            // Program avatar with status dot
            ProgramAvatar(
              programId: channel.programId,
              size: 44,
              showStatusDot: true,
              statusState: channel.displayState,
            ),
            const SizedBox(width: 12),

            // Channel info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        channel.meta.displayName,
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 15,
                          fontWeight: hasUnread ? FontWeight.bold : FontWeight.w500,
                          color: Theme.of(context).colorScheme.onSurface,
                        ),
                      ),
                      if (channel.hasActiveSession) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                          decoration: BoxDecoration(
                            color: channel.isBlocked
                                ? const Color(0xFFFBBF24).withValues(alpha: 0.15)
                                : const Color(0xFF4ADE80).withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            channel.activeSession!.state.toUpperCase(),
                            style: TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.bold,
                              fontFamily: 'monospace',
                              color: channel.isBlocked
                                  ? const Color(0xFFFBBF24)
                                  : const Color(0xFF4ADE80),
                            ),
                          ),
                        ),
                      ],
                      const Spacer(),
                      if (channel.lastActivity != null)
                        Text(
                          _timeAgo(channel.lastActivity!),
                          style: TextStyle(
                            fontSize: 12,
                            color: Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          _previewText(channel, lastMessage),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 13,
                            color: hasUnread
                                ? Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.8)
                                : Theme.of(context).colorScheme.onSurfaceVariant,
                            fontWeight: hasUnread ? FontWeight.w500 : FontWeight.normal,
                          ),
                        ),
                      ),
                      if (channel.pendingQuestionCount > 0)
                        Container(
                          margin: const EdgeInsets.only(left: 8),
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: Theme.of(context).colorScheme.primary,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            '${channel.pendingQuestionCount}',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: Theme.of(context).colorScheme.onPrimary,
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _previewText(ChannelData channel, MessageModel? lastMessage) {
    // Show session status if active and no recent messages
    if (channel.hasActiveSession && lastMessage == null) {
      return channel.activeSession!.status;
    }

    // Show last message preview
    if (lastMessage != null) {
      if (lastMessage.needsResponse) {
        return 'Waiting for response: ${lastMessage.displayTitle}';
      }
      return lastMessage.displayTitle;
    }

    return 'No recent activity';
  }
}
