import 'user.dart';

class Task {
  final String id;
  final String projectId;
  final String title;
  final String? description;
  final String status;
  final String priority;
  final DateTime? startDate;
  final DateTime? endDate;
  final User? assignee;
  final int? estimatedHours;

  const Task({
    required this.id,
    required this.projectId,
    required this.title,
    this.description,
    required this.status,
    required this.priority,
    this.startDate,
    this.endDate,
    this.assignee,
    this.estimatedHours,
  });

  factory Task.fromJson(Map<String, dynamic> json) => Task(
        id: json['id'] as String,
        projectId: json['project_id'] as String,
        title: json['title'] as String,
        description: json['description'] as String?,
        status: json['status'] as String,
        priority: json['priority'] as String,
        startDate: json['start_date'] != null
            ? DateTime.parse(json['start_date'] as String)
            : null,
        endDate: json['end_date'] != null
            ? DateTime.parse(json['end_date'] as String)
            : null,
        assignee: json['assignee'] != null
            ? User.fromJson(json['assignee'] as Map<String, dynamic>)
            : null,
        estimatedHours: json['estimated_hours'] as int?,
      );
}
