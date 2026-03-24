from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import model_validator
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    APP_NAME: str = "planner-bro"
    DEBUG: bool = False
    SECRET_KEY: str = "change-me-in-production"
    ALLOWED_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]
    APP_WEB_URL: str = "http://localhost:3000"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://planner:planner@localhost:5432/plannerdb"
    DATABASE_URL_SYNC: str = "postgresql+psycopg2://planner:planner@localhost:5432/plannerdb"

    # Redis / Celery
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    # JWT
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ALGORITHM: str = "HS256"

    # Google OAuth
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""

    # Firebase
    FIREBASE_CREDENTIALS_PATH: str = "firebase-credentials.json"

    # Email / SMTP
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = False
    SMTP_USE_STARTTLS: bool = True
    EMAILS_FROM: str = "noreply@planner-bro.com"
    SMTP_TIMEOUT_SECONDS: float = 8.0
    SMTP_MAX_ATTEMPTS: int = 3
    SMTP_RETRY_BASE_DELAY_SECONDS: float = 0.7

    # Team status reminders
    TEAM_STATUS_REMINDER_ENABLED: bool = True
    TEAM_STATUS_REMINDER_OVERDUE_DAYS: int = 2
    TEAM_STATUS_REMINDER_SOON_DAYS: int = 5
    TEAM_STATUS_REMINDER_REGULAR_DAYS: int = 14
    TEAM_STATUS_REMINDER_SOON_DEADLINE_WINDOW_DAYS: int = 7
    MANAGEMENT_AUDIT_ENABLED: bool = True
    MANAGEMENT_AUDIT_EMAIL: str = "aerokamero@gmail.com"
    SMTP_ENABLED: bool = True
    EMAIL_ANALYTICS_ENABLED: bool = True
    EMAIL_ANALYTICS_RECIPIENTS: str = ""
    # Test mode: redirect all outgoing emails to a single address for safe testing
    EMAIL_TEST_MODE: bool = False
    EMAIL_TEST_RECIPIENT: str = ""

    # Telegram summaries
    TELEGRAM_BOT_ENABLED: bool = False
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_CHAT_ID: str = ""
    TELEGRAM_TIMEZONE: str = "Asia/Yekaterinburg"
    TELEGRAM_ADMIN_USER_IDS: str = ""

    # Task check-in cadence
    CHECK_IN_SOON_DEADLINE_WINDOW_DAYS: int = 7
    CHECK_IN_HOURS_DEFAULT: int = 168
    CHECK_IN_HOURS_SOON_DEADLINE: int = 48
    CHECK_IN_HOURS_HIGH_PRIORITY: int = 48
    CHECK_IN_HOURS_ESCALATION: int = 24
    CHECK_IN_HOURS_CONTROL_SKI_URGENT: int = 24

    PROJECT_FILES_DIR: str = "uploads/projects"

    # Secure team vault (encrypted file storage)
    VAULT_FILES_DIR: str = "uploads/vault"
    VAULT_ENCRYPTION_KEY: str = ""  # 64-char hex (32-byte key); falls back to SHA-256(SECRET_KEY)

    # AI ingestion (DeepSeek direct preferred; OpenRouter fallback)
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"
    DEEPSEEK_MODEL: str = "deepseek-chat"
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    OPENROUTER_MODEL: str = "deepseek/deepseek-chat"

    @model_validator(mode="after")
    def validate_secret_key(self):
        if not self.DEBUG and self.SECRET_KEY.startswith("change-me"):
            raise ValueError("SECRET_KEY must be set to a strong value when DEBUG=false")
        return self


settings = Settings()
