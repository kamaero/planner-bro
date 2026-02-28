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
  String _typeFilter = 'all';

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
          final notificationsBase = _unreadOnly
              ? notifications.where((n) => !n.isRead).toList()
              : notifications;
          final deadlineCount =
              _countByType(notificationsBase, filter: 'deadline');
          final assignedCount =
              _countByType(notificationsBase, filter: 'assigned');
          final updatesCount =
              _countByType(notificationsBase, filter: 'updates');
          final visibleNotifications = notifications
              .where((n) => !_unreadOnly || !n.isRead)
              .where((n) => _matchesTypeFilter(n))
              .toList();

          if (notifications.isEmpty) {
            return const Center(child: Text('Новых уведомлений нет'));
          }

          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                child: Column(
                  children: [
                    SegmentedButton<bool>(
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
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      children: [
                        ChoiceChip(
                          label: Text('Все типы (${notificationsBase.length})'),
                          selected: _typeFilter == 'all',
                          onSelected: (_) =>
                              setState(() => _typeFilter = 'all'),
                        ),
                        ChoiceChip(
                          label: Text('Дедлайны ($deadlineCount)'),
                          selected: _typeFilter == 'deadline',
                          onSelected: (_) =>
                              setState(() => _typeFilter = 'deadline'),
                        ),
                        ChoiceChip(
                          label: Text('Назначения ($assignedCount)'),
                          selected: _typeFilter == 'assigned',
                          onSelected: (_) =>
                              setState(() => _typeFilter = 'assigned'),
                        ),
                        ChoiceChip(
                          label: Text('Обновления ($updatesCount)'),
                          selected: _typeFilter == 'updates',
                          onSelected: (_) =>
                              setState(() => _typeFilter = 'updates'),
                        ),
                      ],
                    ),
                  ],
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
                              child: Text(_emptyStateLabel()),
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
                                    ? Theme.of(ctx)
                                        .colorScheme
                                        .surfaceContainerHighest
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
                                    '${DateFormat('dd.MM.yyyy, HH:mm').format(n.createdAt.toLocal())} · ${_relativeCreatedAt(n.createdAt)}',
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
                                        notificationId: n.id,
                                        taskId: taskId,
                                      ),
                                    ),
                                  if (projectId != null)
                                    IconButton(
                                      tooltip: 'Открыть',
                                      icon: const Icon(Icons.open_in_new),
                                      onPressed: () async {
                                        await _markNotificationRead(
                                          ref: ref,
                                          notification: n,
                                        );
                                        if (!context.mounted) return;
                                        _openByNotification(
                                          context: context,
                                          notification: n,
                                        );
                                      },
                                    ),
                                ],
                              ),
                              onTap: () async {
                                await _markNotificationRead(
                                  ref: ref,
                                  notification: n,
                                );
                                if (!context.mounted) return;
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
    required String notificationId,
    required String taskId,
  }) async {
    try {
      await apiClient.patch('/tasks/$taskId/status', {'status': 'done'});
      await _markNotificationReadById(ref: ref, notificationId: notificationId);
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

  Future<void> _markNotificationRead({
    required WidgetRef ref,
    required AppNotification notification,
  }) async {
    if (notification.isRead) return;
    await _markNotificationReadById(ref: ref, notificationId: notification.id);
  }

  Future<void> _markNotificationReadById({
    required WidgetRef ref,
    required String notificationId,
  }) async {
    await apiClient.patch('/notifications/$notificationId/read', {});
    ref.invalidate(notificationsProvider);
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

  String _relativeCreatedAt(DateTime createdAt) {
    final now = DateTime.now();
    final local = createdAt.toLocal();
    final date = DateTime(local.year, local.month, local.day);
    final today = DateTime(now.year, now.month, now.day);
    final diff = today.difference(date).inDays;
    if (diff <= 0) return 'сегодня';
    if (diff == 1) return 'вчера';
    if (diff == 2) return 'позавчера';
    if (diff < 7) return 'на неделе';
    return 'ранее';
  }

  bool _matchesTypeFilter(AppNotification notification) {
    return _matchesTypeFor(notification, _typeFilter);
  }

  bool _matchesTypeFor(AppNotification notification, String filter) {
    switch (filter) {
      case 'deadline':
        return notification.type == 'deadline_approaching' ||
            notification.type == 'deadline_missed';
      case 'assigned':
        return notification.type == 'task_assigned';
      case 'updates':
        return notification.type == 'task_updated' ||
            notification.type == 'project_updated' ||
            notification.type == 'new_task';
      default:
        return true;
    }
  }

  int _countByType(
    List<AppNotification> notifications, {
    required String filter,
  }) {
    var count = 0;
    for (final n in notifications) {
      if (_matchesTypeFor(n, filter)) {
        count++;
      }
    }
    return count;
  }

  String _emptyStateLabel() {
    if (_typeFilter != 'all') {
      return 'Нет уведомлений по выбранному типу';
    }
    if (_unreadOnly) {
      return 'Непрочитанных уведомлений нет';
    }
    return 'Уведомлений пока нет';
  }
}
