import 'user.dart';

class Project {
  final String id;
  final String name;
  final String? description;
  final String color;
  final String status;
  final DateTime? startDate;
  final DateTime? endDate;
  final User owner;

  const Project({
    required this.id,
    required this.name,
    this.description,
    required this.color,
    required this.status,
    this.startDate,
    this.endDate,
    required this.owner,
  });

  factory Project.fromJson(Map<String, dynamic> json) => Project(
        id: json['id'] as String,
        name: json['name'] as String,
        description: json['description'] as String?,
        color: json['color'] as String? ?? '#6366f1',
        status: json['status'] as String,
        startDate: json['start_date'] != null
            ? DateTime.parse(json['start_date'] as String)
            : null,
        endDate: json['end_date'] != null
            ? DateTime.parse(json['end_date'] as String)
            : null,
        owner: User.fromJson(json['owner'] as Map<String, dynamic>),
      );
}
