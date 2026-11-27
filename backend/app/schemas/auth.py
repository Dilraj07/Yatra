from typing import Annotated
from pydantic import BaseModel, Field, StringConstraints

LocalSafeEmail = Annotated[
    str,
    StringConstraints(strip_whitespace=True, to_lower=True, min_length=5, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"),
]


class RegisterRequest(BaseModel):
    email: LocalSafeEmail
    full_name: str = Field(min_length=2, max_length=120)
    home_city: str = Field(min_length=2, max_length=80)
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    email: LocalSafeEmail
    password: str


class ClerkSyncRequest(BaseModel):
    email: LocalSafeEmail
    full_name: str = Field(default="Traveler", max_length=120)
    clerk_id: str | None = None
    home_city: str = Field(default="Bengaluru", max_length=80)
    avatar_url: str | None = None

