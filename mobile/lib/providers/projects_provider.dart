import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

import '../core/api_client.dart';
import '../models/user.dart';
import '../models/project.dart';
import '../models/task.dart';
import '../models/notification.dart';
import 'auth_provider.dart';

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

class ReportDeliveryStatus {
  final DateTime generatedAt;
  final int windowHours;
  final int emailSent;
  final int emailFailed;
  final int emailSkipped;
  final int telegramSent;
  final int telegramFailed;
  final DateTime? lastEmailSentAt;
  final DateTime? lastTelegramSentAt;

  const ReportDeliveryStatus({
    required this.generatedAt,
    required this.windowHours,
    required this.emailSent,
    required this.emailFailed,
    required this.emailSkipped,
    required this.telegramSent,
    required this.telegramFailed,
    this.lastEmailSentAt,
    this.lastTelegramSentAt,
  });

  factory ReportDeliveryStatus.fromJson(Map<String, dynamic> json) {
    return ReportDeliveryStatus(
      generatedAt: DateTime.parse(json['generated_at'] as String),
      windowHours: (json['window_hours'] as num?)?.toInt() ?? 24,
      emailSent: (json['email_sent'] as num?)?.toInt() ?? 0,
      emailFailed: (json['email_failed'] as num?)?.toInt() ?? 0,
      emailSkipped: (json['email_skipped'] as num?)?.toInt() ?? 0,
      telegramSent: (json['telegram_sent'] as num?)?.toInt() ?? 0,
      telegramFailed: (json['telegram_failed'] as num?)?.toInt() ?? 0,
      lastEmailSentAt: json['last_email_sent_at'] == null
          ? null
          : DateTime.parse(json['last_email_sent_at'] as String),
      lastTelegramSentAt: json['last_telegram_sent_at'] == null
          ? null
          : DateTime.parse(json['last_telegram_sent_at'] as String),
    );
  }
}

class UserTaskEntry {
  final Task task;
  final Project project;
  final int urgencyRank;

  const UserTaskEntry({
    required this.task,
    required this.project,
    required this.urgencyRank,
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

final reportDeliveryStatusProvider = FutureProvider<ReportDeliveryStatus?>(
  (ref) async {
    try {
      final data = await apiClient.get('/notifications/report-delivery/status');
      return ReportDeliveryStatus.fromJson(data);
    } on DioException catch (e) {
      if (e.response?.statusCode == 403) {
        // Non-manager roles do not have access to dispatch metrics.
        return null;
      }
      rethrow;
    }
  },
);

final myTasksProvider = FutureProvider<List<UserTaskEntry>>((ref) async {
  final me = ref.watch(authProvider).valueOrNull;
  if (me == null) return const <UserTaskEntry>[];

  final projects = await ref.watch(projectsProvider.future);
  final entries = <UserTaskEntry>[];
  for (final project in projects) {
    final rows = await apiClient.getList('/projects/${project.id}/tasks');
    final tasks = rows.map((e) => Task.fromJson(e as Map<String, dynamic>));
    for (final task in tasks) {
      if (!_isAssignedToMe(task, me)) continue;
      entries.add(
        UserTaskEntry(
          task: task,
          project: project,
          urgencyRank: _taskUrgencyRank(task),
        ),
      );
    }
  }

  entries.sort((a, b) {
    final byUrgency = a.urgencyRank.compareTo(b.urgencyRank);
    if (byUrgency != 0) return byUrgency;
    final aDeadline = a.task.endDate;
    final bDeadline = b.task.endDate;
    if (aDeadline == null && bDeadline == null) return 0;
    if (aDeadline == null) return 1;
    if (bDeadline == null) return -1;
    return aDeadline.compareTo(bDeadline);
  });
  return entries;
});

bool _isAssignedToMe(Task task, User me) {
  if (task.assignee != null && task.assignee!.id == me.id) return true;
  return false;
}

int _taskUrgencyRank(Task task) {
  if (task.status == 'done') return 50;
  final now = DateTime.now();
  final deadline = task.endDate;
  if (deadline == null) return 30;
  final dayDiff = deadline.difference(now).inDays;
  if (dayDiff < 0) return 0; // overdue
  if (dayDiff == 0) return 1; // today
  if (dayDiff <= 2) return 2; // very soon
  if (dayDiff <= 7) return 3; // this week
  return 10;
}
