from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return str(uuid4())


class RoomORM(Base):
    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(12), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    host_name: Mapped[str] = mapped_column(String(80), default="방장")
    host_spotify_user_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    host_spotify_display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    host_spotify_refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    spotify_playlist_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    spotify_playlist_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    spotify_playlist_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    spotify_playlist_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    requests: Mapped[list["SongRequestORM"]] = relationship(
        back_populates="room",
        cascade="all, delete-orphan",
    )
    shared_playlists: Mapped[list["SharedPlaylistORM"]] = relationship(
        back_populates="room",
        cascade="all, delete-orphan",
    )


class SongRequestORM(Base):
    __tablename__ = "song_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id"), index=True)
    track_id: Mapped[str] = mapped_column(String(160))
    track_name: Mapped[str] = mapped_column(String(240))
    artists_json: Mapped[str] = mapped_column(Text)
    album: Mapped[str] = mapped_column(String(240), default="")
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spotify_uri: Mapped[str | None] = mapped_column(String(240), nullable=True)
    requester_name: Mapped[str] = mapped_column(String(40), default="익명")
    status: Mapped[str] = mapped_column(String(24), default="queued")
    spotify_result_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    room: Mapped[RoomORM] = relationship(back_populates="requests")


class SharedPlaylistORM(Base):
    __tablename__ = "shared_playlists"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id"), index=True)
    owner_spotify_user_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    owner_name: Mapped[str] = mapped_column(String(120), default="Spotify User")
    playlist_id: Mapped[str] = mapped_column(String(160))
    name: Mapped[str] = mapped_column(String(180))
    description: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    track_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    room: Mapped[RoomORM] = relationship(back_populates="shared_playlists")
    tracks: Mapped[list["SharedPlaylistTrackORM"]] = relationship(
        back_populates="shared_playlist",
        cascade="all, delete-orphan",
    )


class SharedPlaylistTrackORM(Base):
    __tablename__ = "shared_playlist_tracks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    shared_playlist_id: Mapped[str] = mapped_column(ForeignKey("shared_playlists.id"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    track_id: Mapped[str] = mapped_column(String(160))
    track_name: Mapped[str] = mapped_column(String(240))
    artists_json: Mapped[str] = mapped_column(Text)
    album: Mapped[str] = mapped_column(String(240), default="")
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spotify_uri: Mapped[str | None] = mapped_column(String(240), nullable=True)

    shared_playlist: Mapped[SharedPlaylistORM] = relationship(back_populates="tracks")
