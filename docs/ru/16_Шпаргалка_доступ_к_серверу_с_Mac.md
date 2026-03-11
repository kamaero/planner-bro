# Шпаргалка: доступ к planner_bro с другого Mac

## 1. Сгенерировать ключ

```bash
ssh-keygen -t ed25519 -a 100 -f ~/.ssh/planner_bro_ed25519 -C "planner_bro@$(scutil --get ComputerName 2>/dev/null || hostname)"
```

## 2. Добавить ключ в агент и Keychain

```bash
eval "$(ssh-agent -s)"
ssh-add --apple-use-keychain ~/.ssh/planner_bro_ed25519
```

## 3. Добавить host alias в `~/.ssh/config`

```sshconfig
Host planner_bro
  HostName 168.222.194.92
  User root
  Port 22
  IdentityFile ~/.ssh/planner_bro_ed25519
  IdentitiesOnly yes
  ServerAliveInterval 30
  ServerAliveCountMax 3
```

Права:

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/config ~/.ssh/planner_bro_ed25519
chmod 644 ~/.ssh/planner_bro_ed25519.pub
```

## 4. Первый вход паролем (один раз)

```bash
ssh root@168.222.194.92
```

## 5. Установить публичный ключ на сервер

Вариант A (если есть `ssh-copy-id`):

```bash
ssh-copy-id -i ~/.ssh/planner_bro_ed25519.pub root@168.222.194.92
```

Вариант B (ручной):

```bash
cat ~/.ssh/planner_bro_ed25519.pub | ssh root@168.222.194.92 'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys'
```

Проверка:

```bash
ssh planner_bro 'whoami && hostname && date'
```

## 6. Мини-команды эксплуатации

```bash
ssh planner_bro 'docker ps'
ssh planner_bro 'cd /opt/planner-bro && docker compose ps'
ssh planner_bro 'curl -sS https://plannerbro.ru/health'
```

## 7. Если вход не работает

```bash
ssh -vvv planner_bro
ssh -o IdentitiesOnly=yes -i ~/.ssh/planner_bro_ed25519 root@168.222.194.92
```

## 8. Безопасность

- Не хранить пароль root в заметках/чатах.
- Использовать только ключевой вход.
- Желательно отдельный sudo-пользователь вместо постоянной работы под root.
