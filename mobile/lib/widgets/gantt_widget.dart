import 'package:flutter/material.dart';
import '../models/task.dart';

/// Minimal custom Gantt widget for mobile.
/// Shows horizontal bars representing task duration on a timeline.
class GanttWidget extends StatelessWidget {
  final List<Task> tasks;
  const GanttWidget({super.key, required this.tasks});

  @override
  Widget build(BuildContext context) {
    final withDates =
        tasks.where((t) => t.startDate != null && t.endDate != null).toList();

    if (withDates.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Text('Нет задач с датами для отображения.'),
        ),
      );
    }

    final earliest = withDates
        .map((t) => t.startDate!)
        .reduce((a, b) => a.isBefore(b) ? a : b);
    final latest =
        withDates.map((t) => t.endDate!).reduce((a, b) => a.isAfter(b) ? a : b);
    final totalDays = latest.difference(earliest).inDays + 1;
    const dayWidth = 30.0;
    const rowHeight = 48.0;
    final totalWidth = totalDays * dayWidth;

    return SizedBox(
      width: totalWidth + 120,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header: day markers
          Row(
            children: [
              const SizedBox(width: 120),
              ...List.generate(totalDays, (i) {
                final d = earliest.add(Duration(days: i));
                return SizedBox(
                  width: dayWidth,
                  child: Text(
                    i % 5 == 0 ? '${d.day}/${d.month}' : '',
                    style: const TextStyle(fontSize: 9, color: Colors.grey),
                    overflow: TextOverflow.clip,
                  ),
                );
              }),
            ],
          ),
          const Divider(height: 1),
          ...withDates.map((task) {
            final start = task.startDate!.difference(earliest).inDays;
            final duration =
                task.endDate!.difference(task.startDate!).inDays + 1;
            final priority = task.priority;
            final color = <String, Color>{
                  'low': Colors.blue,
                  'medium': Colors.amber,
                  'high': Colors.orange,
                  'critical': Colors.red,
                }[priority] ??
                Colors.indigo;

            return SizedBox(
              height: rowHeight,
              child: Row(
                children: [
                  SizedBox(
                    width: 120,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      child: Text(
                        task.title,
                        style: const TextStyle(fontSize: 11),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                  SizedBox(width: start * dayWidth),
                  Container(
                    width: duration * dayWidth - 4,
                    height: 20,
                    margin: const EdgeInsets.symmetric(vertical: 14),
                    decoration: BoxDecoration(
                      color: color.withOpacity(0.7),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    alignment: Alignment.centerLeft,
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: Text(
                      task.status == 'done' ? '✓' : '',
                      style: const TextStyle(fontSize: 10, color: Colors.white),
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}
