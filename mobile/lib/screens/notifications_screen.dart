import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../core/api_client.dart';
import '../models/notification.dart';
import '../providers/projects_provider.dart';

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() =>
      _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  bool _unreadOnly = false;

  @override
  Widget build(BuildContext context) {
    final notificationsAsync = ref.watch(notificationsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Уведомления'),
        actions: [
          TextButton(
            onPressed: () async {
              await apiClient.post('/notifications/read-all', {});
              ref.invalidate(notificationsProvider);
            },
            child: const Text('Отметить все'),
          ),
        ],
      ),
      body: notificationsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Ошибка: $e')),
        data: (notifications) {
          final visibleNotifications = _unreadOnly
              ? notifications.where((n) => !n.isRead).toList()
              : notifications;

          if (notifications.isEmpty) {
            return const Center(child: Text('Новых уведомлений нет'));
          }

          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                child: SegmentedButton<bool>(
                  segments: const [
                    ButtonSegment<bool>(value: false, label: Text('Все')),
                    ButtonSegment<bool>(
                      value: true,
                      label: Text('Непрочитанные'),
                    ),
                  ],
                  selected: {_unreadOnly},
                  onSelectionChanged: (selection) {
                    setState(() => _unreadOnly = selection.first);
                  },
                ),
              ),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () => ref.refresh(notificationsProvider.future),
                  child: visibleNotifications.isEmpty
                      ? ListView(
                          children: [
                            SizedBox(height: 140),
                            Center(
                              child: Text('Непрочитанных уведомлений нет'),
                            ),
                          ],
                        )
                      : ListView.separated(
                          itemCount: visibleNotifications.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (ctx, i) {
                            final n = visibleNotifications[i];
                            final projectId = _projectIdFrom(n);
                            final taskId = _taskIdFrom(n);
                            final canMarkDone =
                                taskId != null && n.type != 'project_updated';

                            return ListTile(
                              leading: CircleAvatar(
                                backgroundColor: n.isRead
                                    ? Theme.of(ctx).colorScheme.surfaceVariant
                                    : Theme.of(ctx)
                                        .colorScheme
                                        .primaryContainer,
                                child: Icon(
                                  _iconForType(n.type),
                                  size: 20,
                                  color: n.isRead
                                      ? Theme.of(ctx)
                                          .colorScheme
                                          .onSurfaceVariant
                                      : Theme.of(ctx)
                                          .colorScheme
                                          .onPrimaryContainer,
                                ),
                              ),
                              title: Text(
                                n.title,
                                style: TextStyle(
                                  fontWeight: n.isRead
                                      ? FontWeight.normal
                                      : FontWeight.bold,
                                ),
                              ),
                              subtitle: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(n.body),
                                  if (taskId != null || projectId != null)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 4),
                                      child: Text(
                                        taskId != null
                                            ? 'Задача: $taskId'
                                            : 'Проект: $projectId',
                                        style:
                                            Theme.of(ctx).textTheme.bodySmall,
                                      ),
                                    ),
                                  const SizedBox(height: 2),
                                  Text(
                                    DateFormat('dd.MM.yyyy, HH:mm')
                                        .format(n.createdAt.toLocal()),
                                    style: Theme.of(ctx).textTheme.bodySmall,
                                  ),
                                ],
                              ),
                              isThreeLine: true,
                              trailing: Wrap(
                                spacing: 4,
                                children: [
                                  if (canMarkDone)
                                    IconButton(
                                      tooltip: 'Выполнено',
                                      icon: const Icon(
                                        Icons.check_circle_outline,
                                      ),
                                      onPressed: () => _markTaskDone(
                                        context: context,
                                        ref: ref,
                                        taskId: taskId,
                                      ),
                                    ),
                                  if (projectId != null)
                                    IconButton(
                                      tooltip: 'Открыть',
                                      icon: const Icon(Icons.open_in_new),
                                      onPressed: () => _openByNotification(
                                        context: context,
                                        notification: n,
                                      ),
                                    ),
                                ],
                              ),
                              onTap: () async {
                                if (!n.isRead) {
                                  await apiClient.patch(
                                    '/notifications/${n.id}/read',
                                    {},
                                  );
                                  ref.invalidate(notificationsProvider);
                                }
                                _openByNotification(
                                  context: context,
                                  notification: n,
                                );
                              },
                            );
                          },
                        ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  String? _projectIdFrom(AppNotification n) {
    final value = n.data?['project_id'];
    if (value == null) return null;
    final projectId = value.toString().trim();
    return projectId.isEmpty ? null : projectId;
  }

  String? _taskIdFrom(AppNotification n) {
    final value = n.data?['task_id'];
    if (value == null) return null;
    final taskId = value.toString().trim();
    return taskId.isEmpty ? null : taskId;
  }

  void _openByNotification({
    required BuildContext context,
    required AppNotification notification,
  }) {
    final projectId = _projectIdFrom(notification);
    final taskId = _taskIdFrom(notification);
    if (projectId != null) {
      if (taskId != null) {
        context.push('/projects/$projectId?task=$taskId');
        return;
      }
      context.push('/projects/$projectId');
    }
  }

  Future<void> _markTaskDone({
    required BuildContext context,
    required WidgetRef ref,
    required String taskId,
  }) async {
    try {
      await apiClient.patch('/tasks/$taskId/status', {'status': 'done'});
      ref.invalidate(notificationsProvider);
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Задача отмечена как выполненная')),
      );
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Не удалось обновить задачу: $e')),
      );
    }
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
