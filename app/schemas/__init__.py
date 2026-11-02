from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class ChatRequest(BaseModel):
    session_id: str | None = None
    message_id: str
    text: str = ""
    images: list[str] = Field(default_factory=list)


class EscalateRequest(BaseModel):
    session_id: str | None = None
    reason: str = "客户要求转人工"


class AgentMessageRequest(BaseModel):
    text: str
    msg_type: str = "text"


class CloseRequest(BaseModel):
    result: str = "已解决"


class FeedbackRequest(BaseModel):
    session_id: str
    score: int = Field(ge=1, le=5)
    comment: str = ""


class UserCreate(BaseModel):
    username: str
    name: str
    role: Literal["admin", "user"] = "user"
    staff_role: str | None = None
    dept: str = ""
    phone: str = ""
    password: str | None = None


class UserUpdate(BaseModel):
    name: str | None = None
    role: Literal["admin", "user"] | None = None
    staff_role: str | None = None
    dept: str | None = None
    phone: str | None = None
    status: Literal["active", "disabled"] | None = None


class FaqDraftRequest(BaseModel):
    question: str | None = None
    answer: str | None = None
    category: str = "报警处理"


class ReparseRequest(BaseModel):
    force: bool = True


class ChatMessageOut(BaseModel):
    id: str
    role: str
    text: str
    at: str
    citations: list = Field(default_factory=list)

