from datetime import datetime
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


class RequestStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    queued = "queued"
    added = "added"
    failed = "failed"


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


class CreateRoomRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    host_name: str = Field(default="방장", max_length=80)


class Room(BaseModel):
    id: str
    code: str
    name: str
    host_name: str
    host_spotify_display_name: str | None = None
    spotify_connected: bool
    spotify_playlist_id: str | None = None
    spotify_playlist_name: str | None = None
    spotify_playlist_url: str | None = None
    spotify_playlist_image_url: str | None = None
    created_at: datetime


class RoomDetail(Room):
    request_count: int = 0
    shared_playlist_count: int = 0


class RoomSongRequest(BaseModel):
    id: str
    track: Track
    requester_name: str
    status: RequestStatus
    spotify: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class SharedPlaylist(BaseModel):
    id: str
    owner_name: str
    playlist_id: str
    name: str
    description: str = ""
    image_url: str | None = None
    external_url: str | None = None
    track_count: int = 0
    created_at: datetime


class RoomStats(BaseModel):
    total_requests: int
    added_requests: int
    shared_playlists: int
    top_artists: list[dict[str, Any]]
    top_tracks: list[dict[str, Any]]
    insight: str
