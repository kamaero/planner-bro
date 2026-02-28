import 'package:flutter/material.dart';
import '../models/task.dart';

class TaskCardWidget extends StatelessWidget {
  final Task task;
  final VoidCallback? onTap;
  const TaskCardWidget({super.key, required this.task, this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _PriorityDot(priority: task.priority),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      task.title,
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                  ),
                  _StatusBadge(status: task.status),
                ],
              ),
              if (task.description != null) ...[
                const SizedBox(height: 6),
                Text(
                  task.description!,
                  style: Theme.of(context).textTheme.bodySmall,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              const SizedBox(height: 8),
              Row(
                children: [
                  if (task.assignee != null) ...[
                    const Icon(Icons.person_outline,
                        size: 14, color: Colors.grey),
                    const SizedBox(width: 4),
                    Text(task.assignee!.name,
                        style:
                            const TextStyle(fontSize: 12, color: Colors.grey)),
                    const SizedBox(width: 12),
                  ],
                  if (task.endDate != null) ...[
                    const Icon(Icons.calendar_today_outlined,
                        size: 14, color: Colors.grey),
                    const SizedBox(width: 4),
                    Text(
                      '${task.endDate!.day}/${task.endDate!.month}/${task.endDate!.year}',
                      style: const TextStyle(fontSize: 12, color: Colors.grey),
                    ),
                    const SizedBox(width: 12),
                  ],
                  if (task.updatedAt != null) ...[
                    const Icon(Icons.update_outlined,
                        size: 14, color: Colors.grey),
                    const SizedBox(width: 4),
                    Text(
                      _updatedLabel(task.updatedAt!),
                      style: const TextStyle(fontSize: 12, color: Colors.grey),
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
}

String _updatedLabel(DateTime updatedAt) {
  final now = DateTime.now();
  final local = updatedAt.toLocal();
  final taskDate = DateTime(local.year, local.month, local.day);
  final today = DateTime(now.year, now.month, now.day);
  final diff = today.difference(taskDate).inDays;
  if (diff <= 0) return 'обновлено сегодня';
  if (diff == 1) return 'обновлено вчера';
  if (diff == 2) return 'обновлено позавчера';
  if (diff < 7) return 'обновлено на неделе';
  return 'обновлено давно';
}

class _PriorityDot extends StatelessWidget {
  final String priority;
  const _PriorityDot({required this.priority});

  @override
  Widget build(BuildContext context) {
    final colors = <String, Color>{
      'low': Colors.blue,
      'medium': Colors.amber,
      'high': Colors.orange,
      'critical': Colors.red,
    };
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        color: colors[priority] ?? Colors.grey,
        shape: BoxShape.circle,
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final String status;
  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    final labels = <String, String>{
      'planning': 'Планирование',
      'tz': 'ТЗ',
      'todo': 'К выполнению',
      'in_progress': 'В работе',
      'testing': 'Тестирование',
      'review': 'Проверка',
      'done': 'Выполнено',
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        labels[status] ?? status,
        style: const TextStyle(fontSize: 11),
      ),
    );
  }
}
