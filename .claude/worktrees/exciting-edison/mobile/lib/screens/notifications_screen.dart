import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../providers/projects_provider.dart';
import '../core/api_client.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notificationsAsync = ref.watch(notificationsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          TextButton(
            onPressed: () async {
              await apiClient.post('/notifications/read-all', {});
              ref.invalidate(notificationsProvider);
            },
            child: const Text('Mark all read'),
          ),
        ],
      ),
      body: notificationsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (notifications) {
          if (notifications.isEmpty) {
            return const Center(child: Text('No notifications'));
          }
          return RefreshIndicator(
            onRefresh: () => ref.refresh(notificationsProvider.future),
            child: ListView.separated(
              itemCount: notifications.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (ctx, i) {
                final n = notifications[i];
                return ListTile(
                  leading: CircleAvatar(
                    backgroundColor: n.isRead
                        ? Theme.of(ctx).colorScheme.surfaceVariant
                        : Theme.of(ctx).colorScheme.primaryContainer,
                    child: Icon(
                      _iconForType(n.type),
                      size: 20,
                      color: n.isRead
                          ? Theme.of(ctx).colorScheme.onSurfaceVariant
                          : Theme.of(ctx).colorScheme.onPrimaryContainer,
                    ),
                  ),
                  title: Text(
                    n.title,
                    style: TextStyle(
                      fontWeight: n.isRead ? FontWeight.normal : FontWeight.bold,
                    ),
                  ),
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(n.body),
                      const SizedBox(height: 2),
                      Text(
                        DateFormat('MMM d, HH:mm').format(n.createdAt.toLocal()),
                        style: Theme.of(ctx).textTheme.bodySmall,
                      ),
                    ],
                  ),
                  isThreeLine: true,
                  onTap: () async {
                    if (!n.isRead) {
                      await apiClient.patch('/notifications/${n.id}/read', {});
                      ref.invalidate(notificationsProvider);
                    }
                  },
                );
              },
            ),
          );
        },
      ),
    );
  }

  IconData _iconForType(String type) {
    switch (type) {
      case 'deadline_approaching':
      case 'deadline_missed':
        return Icons.schedule;
      case 'task_assigned':
        return Icons.assignment_ind;
      case 'task_updated':
        return Icons.edit;
      case 'new_task':
        return Icons.add_task;
      default:
        return Icons.notifications;
    }
  }
}
