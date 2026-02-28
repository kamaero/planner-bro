import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/api_client.dart';
import '../models/project.dart';
import '../models/task.dart';
import '../models/notification.dart';

class MobileAnalyticsData {
  final int projectsCount;
  final int tasksCount;
  final int doneTasksCount;
  final int overdueTasksCount;
  final Map<String, int> statusCounts;

  const MobileAnalyticsData({
    required this.projectsCount,
    required this.tasksCount,
    required this.doneTasksCount,
    required this.overdueTasksCount,
    required this.statusCounts,
  });
}

final projectsProvider = FutureProvider<List<Project>>((ref) async {
  final data = await apiClient.getList('/projects/');
  return data.map((e) => Project.fromJson(e as Map<String, dynamic>)).toList();
});

final projectProvider = FutureProvider.family<Project, String>((ref, id) async {
  final data = await apiClient.get('/projects/$id');
  return Project.fromJson(data);
});

final tasksProvider =
    FutureProvider.family<List<Task>, String>((ref, projectId) async {
  final data = await apiClient.getList('/projects/$projectId/tasks');
  return data.map((e) => Task.fromJson(e as Map<String, dynamic>)).toList();
});

final notificationsProvider =
    FutureProvider<List<AppNotification>>((ref) async {
  final data = await apiClient.getList('/notifications');
  return data
      .map((e) => AppNotification.fromJson(e as Map<String, dynamic>))
      .toList();
});

final analyticsProvider = FutureProvider<MobileAnalyticsData>((ref) async {
  final projects = await ref.watch(projectsProvider.future);
  final allTasks = <Task>[];
  for (final project in projects) {
    final data = await apiClient.getList('/projects/${project.id}/tasks');
    allTasks.addAll(
      data.map((e) => Task.fromJson(e as Map<String, dynamic>)),
    );
  }

  final now = DateTime.now();
  final statusCounts = <String, int>{
    'planning': 0,
    'tz': 0,
    'todo': 0,
    'in_progress': 0,
    'testing': 0,
    'review': 0,
    'done': 0,
  };
  var done = 0;
  var overdue = 0;
  for (final task in allTasks) {
    statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
    if (task.status == 'done') done++;
    if (task.status != 'done' &&
        task.endDate != null &&
        task.endDate!.isBefore(now)) {
      overdue++;
    }
  }

  return MobileAnalyticsData(
    projectsCount: projects.length,
    tasksCount: allTasks.length,
    doneTasksCount: done,
    overdueTasksCount: overdue,
    statusCounts: statusCounts,
  );
});
