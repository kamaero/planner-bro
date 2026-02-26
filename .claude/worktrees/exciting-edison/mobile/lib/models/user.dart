class User {
  final String id;
  final String email;
  final String name;
  final String role;
  final String? avatarUrl;

  const User({
    required this.id,
    required this.email,
    required this.name,
    required this.role,
    this.avatarUrl,
  });

  factory User.fromJson(Map<String, dynamic> json) => User(
        id: json['id'] as String,
        email: json['email'] as String,
        name: json['name'] as String,
        role: json['role'] as String,
        avatarUrl: json['avatar_url'] as String?,
      );
}
