import 'user.dart';

class Task {
  final String id;
  final String projectId;
  final String title;
  final String? description;
  final String status;
  final String priority;
  final int progressPercent;
  final String? nextStep;
  final DateTime? startDate;
  final DateTime? endDate;
  final User? assignee;
  final int? estimatedHours;
  final DateTime? updatedAt;

  const Task({
    required this.id,
    required this.projectId,
    required this.title,
    this.description,
    required this.status,
    required this.priority,
    required this.progressPercent,
    this.nextStep,
    this.startDate,
    this.endDate,
    this.assignee,
    this.estimatedHours,
    this.updatedAt,
  });

  factory Task.fromJson(Map<String, dynamic> json) => Task(
        id: json['id'] as String,
        projectId: json['project_id'] as String,
        title: json['title'] as String,
        description: json['description'] as String?,
        status: json['status'] as String,
        priority: json['priority'] as String,
        progressPercent: (json['progress_percent'] as num?)?.toInt() ?? 0,
        nextStep: json['next_step'] as String?,
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
        updatedAt: json['updated_at'] != null
            ? DateTime.parse(json['updated_at'] as String)
            : null,
      );
}
