import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../providers/projects_provider.dart';

const _statusLabels = <String, String>{
  'planning': 'Планирование',
  'tz': 'ТЗ',
  'todo': 'К выполнению',
  'in_progress': 'В работе',
  'testing': 'Тестирование',
  'review': 'На проверке',
  'done': 'Выполнено',
};

class AnalyticsScreen extends ConsumerWidget {
  const AnalyticsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final analyticsAsync = ref.watch(analyticsProvider);
    final deliveryAsync = ref.watch(reportDeliveryStatusProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Аналитика')),
      body: analyticsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Ошибка загрузки аналитики: $e')),
        data: (data) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(analyticsProvider);
            ref.invalidate(reportDeliveryStatusProvider);
          },
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  Expanded(
                    child: _MetricCard(
                      title: 'Проектов',
                      value: data.projectsCount.toString(),
                      icon: Icons.folder_open,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _MetricCard(
                      title: 'Задач',
                      value: data.tasksCount.toString(),
                      icon: Icons.task_alt,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _MetricCard(
                      title: 'Выполнено',
                      value: data.doneTasksCount.toString(),
                      icon: Icons.check_circle_outline,
                      valueColor: Colors.green,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _MetricCard(
                      title: 'Просрочено',
                      value: data.overdueTasksCount.toString(),
                      icon: Icons.warning_amber_rounded,
                      valueColor: Colors.red,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Text('Статусы задач',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    children: [
                      for (final entry in data.statusCounts.entries)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Row(
                            children: [
                              Expanded(
                                  child: Text(
                                      _statusLabels[entry.key] ?? entry.key)),
                              Text(
                                '${entry.value}',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w700),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Доставка отчётов',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              deliveryAsync.when(
                loading: () => const Card(
                  child: Padding(
                    padding: EdgeInsets.all(16),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                ),
                error: (e, _) => Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text('Не удалось загрузить статус рассылок: $e'),
                  ),
                ),
                data: (status) {
                  if (status == null) {
                    return const Card(
                      child: Padding(
                        padding: EdgeInsets.all(12),
                        child: Text(
                          'Доступно только руководителю/администратору.',
                        ),
                      ),
                    );
                  }
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Окно: ${status.windowHours} ч.'),
                          const SizedBox(height: 8),
                          _deliveryRow(
                            label: 'Email',
                            sent: status.emailSent,
                            failed: status.emailFailed,
                            skipped: status.emailSkipped,
                          ),
                          const SizedBox(height: 6),
                          _deliveryRow(
                            label: 'Telegram',
                            sent: status.telegramSent,
                            failed: status.telegramFailed,
                            skipped: 0,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Последний email: ${_fmtDate(status.lastEmailSentAt)}',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                          Text(
                            'Последний telegram: ${_fmtDate(status.lastTelegramSentAt)}',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _deliveryRow({
    required String label,
    required int sent,
    required int failed,
    required int skipped,
  }) {
    return Row(
      children: [
        Expanded(child: Text(label)),
        Text(
          'усп $sent',
          style: const TextStyle(
            color: Colors.green,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(width: 10),
        Text(
          'ош $failed',
          style: const TextStyle(
            color: Colors.red,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(width: 10),
        Text(
          'проп $skipped',
          style: const TextStyle(
            color: Colors.orange,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }

  String _fmtDate(DateTime? value) {
    if (value == null) return 'нет данных';
    return DateFormat('dd.MM.yyyy HH:mm').format(value.toLocal());
  }
}

class _MetricCard extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color? valueColor;

  const _MetricCard({
    required this.title,
    required this.value,
    required this.icon,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 20, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 10),
            Text(title, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 4),
            Text(
              value,
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: valueColor,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}
