import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/api_client.dart';
import '../models/project.dart';
import '../models/task.dart';
import '../models/notification.dart';

final projectsProvider = FutureProvider<List<Project>>((ref) async {
  final data = await apiClient.getList('/projects/');
  return data.map((e) => Project.fromJson(e as Map<String, dynamic>)).toList();
});

final projectProvider = FutureProvider.family<Project, String>((ref, id) async {
  final data = await apiClient.get('/projects/$id');
  return Project.fromJson(data);
});

final tasksProvider = FutureProvider.family<List<Task>, String>((ref, projectId) async {
  final data = await apiClient.getList('/projects/$projectId/tasks');
  return data.map((e) => Task.fromJson(e as Map<String, dynamic>)).toList();
});

final notificationsProvider = FutureProvider<List<AppNotification>>((ref) async {
  final data = await apiClient.getList('/notifications');
  return data.map((e) => AppNotification.fromJson(e as Map<String, dynamic>)).toList();
});
