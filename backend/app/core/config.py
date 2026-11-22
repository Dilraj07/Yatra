from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql://yatra:yatra_secret@localhost:5432/yatra_db"
    mongo_url: str = "mongodb://localhost:27017"
    mongo_db: str = "yatra_nosql"
    jwt_secret: str = "yatra-dev-jwt-secret-change-in-production"
    jwt_exp_hours: int = 24

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    duffel_api_key: str = ""
    liteapi_key: str = ""
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""


settings = Settings()
