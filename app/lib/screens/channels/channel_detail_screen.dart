import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/channel_provider.dart';
import '../../theme/program_colors.dart';
import '../../widgets/channel_event_tile.dart';
import '../../widgets/session_pinned_card.dart';
import '../../widgets/inline_compose.dart';
import '../../widgets/program_avatar.dart';
import '../../services/haptic_service.dart';

class ChannelDetailScreen extends ConsumerWidget {
  final String programId;

  const ChannelDetailScreen({
    super.key,
    required this.programId,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channelAsync = ref.watch(channelDetailProvider(programId));
    final meta = ProgramRegistry.get(programId);

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            HapticService.light();
            context.pop();
          },
        ),
        title: Row(
          children: [
            ProgramAvatar(
              programId: programId,
              size: 28,
              showStatusDot: false,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    meta.displayName,
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  channelAsync.when(
                    data: (channel) => Text(
                      channel.hasActiveSession
                          ? channel.activeSession!.state.toUpperCase()
                          : 'Offline',
                      style: TextStyle(
                        fontSize: 11,
                        fontFamily: 'monospace',
                        color: channel.hasActiveSession
                            ? (channel.isBlocked ? const Color(0xFFFBBF24) : const Color(0xFF4ADE80))
                            : Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                    loading: () => const SizedBox.shrink(),
                    error: (_, __) => const SizedBox.shrink(),
                  ),
                ],
              ),
            ),
          ],
        ),
        centerTitle: false,
      ),
      body: channelAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(
          child: Text('Error: $error'),
        ),
        data: (channel) => Column(
          children: [
            // Pinned session card (if active)
            if (channel.activeSession != null)
              SessionPinnedCard(
                session: channel.activeSession!,
                programId: programId,
                onTap: () {
                  HapticService.light();
                  context.push('/sessions/${channel.activeSession!.id}');
                },
              ),

            // Event feed
            Expanded(
              child: channel.messages.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          ProgramAvatar(programId: programId, size: 64),
                          const SizedBox(height: 16),
                          Text(
                            'No messages with ${meta.displayName}',
                            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Send a message to start a conversation',
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Theme.of(context).colorScheme.onSurfaceVariant.withOpacity(0.7),
                            ),
                          ),
                        ],
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.only(top: 8, bottom: 8),
                      reverse: true, // newest at bottom like a chat
                      itemCount: channel.messages.length,
                      itemBuilder: (context, index) {
                        // Reverse index since ListView is reversed
                        final message = channel.messages[channel.messages.length - 1 - index];
                        return ChannelEventTile(
                          message: message,
                          onQuickReply: (reply) {
                            // TODO: Wire to answer question service in Story 4A
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text('Reply: $reply')),
                            );
                          },
                        );
                      },
                    ),
            ),

            // Inline compose bar
            InlineCompose(
              targetProgramId: programId,
              onSend: (payload) {
                // TODO: Wire to create message/task service in Story 4A
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('Sent to ${meta.displayName}: ${payload.content}'),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
