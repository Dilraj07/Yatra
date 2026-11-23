from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    home_city: str = Field(min_length=2, max_length=80)
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ClerkSyncRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(default="Traveler", max_length=120)
    clerk_id: str | None = None
    home_city: str = Field(default="Bengaluru", max_length=80)
    avatar_url: str | None = None

