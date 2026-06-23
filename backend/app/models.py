from datetime import datetime
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


class RequestStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class Track(BaseModel):
    id: str
    name: str
    artists: list[str]
    album: str = ""
    image_url: str | None = None
    duration_ms: int | None = None
    spotify_uri: str | None = None


class CreateSongRequest(BaseModel):
    track: Track
    requester_name: str = Field(default="익명", max_length=30)


class SongRequest(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    track: Track
    requester_name: str
    status: RequestStatus = RequestStatus.pending
    created_at: datetime = Field(default_factory=datetime.utcnow)
    approved_at: datetime | None = None
    playback_order: int | None = None


class Venue(BaseModel):
    name: str
    description: str
    now_playing: Track
    queue_size: int


class AdminActionResponse(BaseModel):
    request: SongRequest
    spotify: dict[str, Any]

