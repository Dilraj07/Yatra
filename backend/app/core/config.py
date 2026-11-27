from pathlib import Path
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_CORE_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _CORE_DIR.parent.parent
_ROOT_DIR = _BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(
            str(_BACKEND_DIR / ".env"),
            str(_ROOT_DIR / ".env"),
            str(_ROOT_DIR / "frontend" / ".env.local"),
            ".env",
            ".env.local",
        ),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql://yatra:yatra_secret@localhost:5432/yatra_db"
    mongo_url: str = "mongodb://localhost:27017"
    mongo_db: str = "yatra_nosql"
    jwt_secret: str = "yatra-dev-jwt-secret-change-in-production"
    jwt_exp_hours: int = 24
    dev_auth_bypass: bool = False
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # OpenAI Integration (accepts OPEN_AI_API, OPENAI_API_KEY, openai_api_key)
    openai_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("OPEN_AI_API", "OPENAI_API_KEY", "openai_api_key"),
    )
    openai_model: str = Field(
        default="gpt-4o-mini",
        validation_alias=AliasChoices("OPENAI_MODEL", "openai_model"),
    )

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    duffel_api_key: str = ""
    liteapi_key: str = ""
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""


settings = Settings()
