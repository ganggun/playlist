from collections import Counter
from html import escape
from io import BytesIO
import json
import random
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
import qrcode
from sqlalchemy import func
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db, init_db
from .models import (
    AdminActionResponse,
    CreateRoomRequest,
    CreateSongRequest,
    RequestStatus,
    RoomDetail,
    RoomSongRequest,
    RoomStats,
    SharedPlaylist,
    SongRequest,
    Track,
    Venue,
)
from .orm import RoomORM, SharedPlaylistORM, SongRequestORM
from .spotify import spotify
from .store import DEMO_TRACKS, store


app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    if settings.admin_token and x_admin_token != settings.admin_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin token")


def _new_room_code(db: Session) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    for _ in range(100):
        code = "".join(random.choice(alphabet) for _ in range(6))
        if db.query(RoomORM).filter(RoomORM.code == code).first() is None:
            return code
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not create room code")


def _get_room(db: Session, code: str) -> RoomORM:
    room = db.query(RoomORM).filter(RoomORM.code == code.upper()).first()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    return room


def _json_list(value: str) -> list[str]:
    try:
        loaded = json.loads(value)
        return loaded if isinstance(loaded, list) else []
    except json.JSONDecodeError:
        return []


def _json_dict(value: str) -> dict[str, Any]:
    try:
        loaded = json.loads(value)
        return loaded if isinstance(loaded, dict) else {}
    except json.JSONDecodeError:
        return {}


def _room_to_schema(db: Session, room: RoomORM) -> RoomDetail:
    request_count = db.query(func.count(SongRequestORM.id)).filter(SongRequestORM.room_id == room.id).scalar() or 0
    shared_count = db.query(func.count(SharedPlaylistORM.id)).filter(SharedPlaylistORM.room_id == room.id).scalar() or 0
    return RoomDetail(
        id=room.id,
        code=room.code,
        name=room.name,
        host_name=room.host_name,
        host_spotify_display_name=room.host_spotify_display_name,
        spotify_connected=bool(room.host_spotify_refresh_token and room.spotify_playlist_id),
        spotify_playlist_id=room.spotify_playlist_id,
        spotify_playlist_name=room.spotify_playlist_name,
        spotify_playlist_url=room.spotify_playlist_url,
        spotify_playlist_image_url=room.spotify_playlist_image_url,
        created_at=room.created_at,
        request_count=request_count,
        shared_playlist_count=shared_count,
    )


def _track_from_request(row: SongRequestORM) -> Track:
    return Track(
        id=row.track_id,
        name=row.track_name,
        artists=_json_list(row.artists_json),
        album=row.album,
        image_url=row.image_url,
        duration_ms=row.duration_ms,
        spotify_uri=row.spotify_uri,
    )


def _request_to_schema(row: SongRequestORM) -> RoomSongRequest:
    return RoomSongRequest(
        id=row.id,
        track=_track_from_request(row),
        requester_name=row.requester_name,
        status=RequestStatus(row.status),
        spotify=_json_dict(row.spotify_result_json),
        created_at=row.created_at,
    )


def _shared_to_schema(row: SharedPlaylistORM) -> SharedPlaylist:
    return SharedPlaylist(
        id=row.id,
        owner_name=row.owner_name,
        playlist_id=row.playlist_id,
        name=row.name,
        description=row.description,
        image_url=row.image_url,
        external_url=row.external_url,
        track_count=row.track_count,
        created_at=row.created_at,
    )


def _playlist_payload(item: dict[str, Any]) -> dict[str, Any]:
    images = item.get("images") or []
    tracks = item.get("tracks") or {}
    return {
        "playlist_id": item.get("id", ""),
        "name": item.get("name", "Untitled playlist"),
        "description": item.get("description") or "",
        "image_url": images[0].get("url") if images else None,
        "external_url": (item.get("external_urls") or {}).get("spotify"),
        "track_count": tracks.get("total") or 0,
    }


def _success_html(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(
        f"""
        <html>
          <head><title>{escape(title)}</title></head>
          <body style="background:#121212;color:#fff;font-family:system-ui;max-width:720px;margin:48px auto;line-height:1.55;">
            <h1>{escape(title)}</h1>
            <p>{body}</p>
          </body>
        </html>
        """
    )


@app.get("/")
def root() -> dict[str, str]:
    return {"name": settings.app_name, "status": "ok"}


@app.get("/health")
@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/rooms", response_model=RoomDetail, status_code=status.HTTP_201_CREATED)
def create_room(payload: CreateRoomRequest, db: Session = Depends(get_db)) -> RoomDetail:
    room = RoomORM(
        code=_new_room_code(db),
        name=payload.name.strip(),
        host_name=payload.host_name.strip() or "방장",
    )
    db.add(room)
    db.commit()
    db.refresh(room)
    return _room_to_schema(db, room)


@app.get("/api/rooms/{code}", response_model=RoomDetail)
def get_room(code: str, db: Session = Depends(get_db)) -> RoomDetail:
    return _room_to_schema(db, _get_room(db, code))


@app.get("/api/rooms/{code}/qr")
def room_qr(code: str, db: Session = Depends(get_db)) -> Response:
    room = _get_room(db, code)
    url = f"{settings.resolved_public_app_url}/?room={room.code}"
    qr = qrcode.QRCode(box_size=10, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    image = qr.make_image(fill_color="#000000", back_color="#ffffff")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return Response(content=buffer.getvalue(), media_type="image/png")


@app.get("/api/rooms/{code}/tracks/search", response_model=list[Track])
async def search_room_tracks(code: str, q: str = Query(default=""), db: Session = Depends(get_db)) -> list[Track]:
    _get_room(db, code)
    return await _search_tracks(q)


@app.post("/api/rooms/{code}/requests", response_model=RoomSongRequest, status_code=status.HTTP_201_CREATED)
async def create_room_song_request(
    code: str,
    payload: CreateSongRequest,
    db: Session = Depends(get_db),
) -> RoomSongRequest:
    room = _get_room(db, code)
    clean_name = payload.requester_name.strip() or "익명"
    row = SongRequestORM(
        room_id=room.id,
        track_id=payload.track.id,
        track_name=payload.track.name,
        artists_json=json.dumps(payload.track.artists, ensure_ascii=False),
        album=payload.track.album,
        image_url=payload.track.image_url,
        duration_ms=payload.track.duration_ms,
        spotify_uri=payload.track.spotify_uri,
        requester_name=clean_name,
        status=RequestStatus.queued.value,
        spotify_result_json="{}",
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    spotify_result: dict[str, Any]
    if room.host_spotify_refresh_token and room.spotify_playlist_id:
        try:
            spotify_result = await spotify.add_to_playlist(
                payload.track,
                refresh_token=room.host_spotify_refresh_token,
                playlist_id=room.spotify_playlist_id,
            )
            row.status = RequestStatus.added.value if spotify_result.get("added") else RequestStatus.queued.value
        except Exception as exc:
            spotify_result = {"mode": "spotify", "added": False, "reason": str(exc)}
            row.status = RequestStatus.failed.value
    else:
        spotify_result = {"mode": "room", "added": False, "reason": "Host Spotify playlist is not connected"}
        row.status = RequestStatus.queued.value

    row.spotify_result_json = json.dumps(spotify_result, ensure_ascii=False)
    db.commit()
    db.refresh(row)
    return _request_to_schema(row)


@app.get("/api/rooms/{code}/requests", response_model=list[RoomSongRequest])
def list_room_song_requests(code: str, db: Session = Depends(get_db)) -> list[RoomSongRequest]:
    room = _get_room(db, code)
    rows = (
        db.query(SongRequestORM)
        .filter(SongRequestORM.room_id == room.id)
        .order_by(SongRequestORM.created_at.desc())
        .all()
    )
    return [_request_to_schema(row) for row in rows]


@app.get("/api/rooms/{code}/shared-playlists", response_model=list[SharedPlaylist])
def list_shared_playlists(code: str, db: Session = Depends(get_db)) -> list[SharedPlaylist]:
    room = _get_room(db, code)
    rows = (
        db.query(SharedPlaylistORM)
        .filter(SharedPlaylistORM.room_id == room.id)
        .order_by(SharedPlaylistORM.created_at.desc())
        .all()
    )
    return [_shared_to_schema(row) for row in rows]


@app.get("/api/rooms/{code}/stats", response_model=RoomStats)
def room_stats(code: str, db: Session = Depends(get_db)) -> RoomStats:
    room = _get_room(db, code)
    rows = db.query(SongRequestORM).filter(SongRequestORM.room_id == room.id).all()
    artist_counter: Counter[str] = Counter()
    track_counter: Counter[str] = Counter()
    for row in rows:
        for artist in _json_list(row.artists_json):
            artist_counter[artist] += 1
        track_counter[row.track_name] += 1

    top_artists = [{"name": name, "count": count} for name, count in artist_counter.most_common(5)]
    top_tracks = [{"name": name, "count": count} for name, count in track_counter.most_common(5)]
    added_count = sum(1 for row in rows if row.status == RequestStatus.added.value)
    shared_count = db.query(func.count(SharedPlaylistORM.id)).filter(SharedPlaylistORM.room_id == room.id).scalar() or 0
    if top_artists:
        names = ", ".join(item["name"] for item in top_artists[:3])
        insight = f"{room.name}에서는 {names} 음악이 자주 신청되고 있어요."
    else:
        insight = f"{room.name}의 취향을 모으는 중이에요."

    return RoomStats(
        total_requests=len(rows),
        added_requests=added_count,
        shared_playlists=shared_count,
        top_artists=top_artists,
        top_tracks=top_tracks,
        insight=insight,
    )


@app.get("/api/rooms/{code}/spotify/login")
def room_spotify_login(code: str, db: Session = Depends(get_db)) -> RedirectResponse:
    room = _get_room(db, code)
    try:
        url = spotify.build_scoped_authorize_url(scope=settings.spotify_scope, state=f"host:{room.code}")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Spotify OAuth is not configured",
        ) from exc
    return RedirectResponse(url)


@app.get("/api/rooms/{code}/spotify/share/login")
def share_spotify_login(code: str, db: Session = Depends(get_db)) -> RedirectResponse:
    room = _get_room(db, code)
    scope = "playlist-read-private playlist-read-collaborative"
    try:
        url = spotify.build_scoped_authorize_url(scope=scope, state=f"share:{room.code}")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Spotify OAuth is not configured",
        ) from exc
    return RedirectResponse(url)


@app.get("/api/auth/spotify/login")
def spotify_login() -> RedirectResponse:
    try:
        url = spotify.build_authorize_url()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Spotify OAuth is not configured",
        ) from exc
    return RedirectResponse(url)


@app.get("/api/auth/spotify/callback", response_class=HTMLResponse)
async def spotify_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
) -> HTMLResponse:
    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing Spotify code")

    try:
        token_data = await spotify.exchange_code(code)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Spotify token exchange failed",
        ) from exc

    if state and ":" in state:
        mode, room_code = state.split(":", 1)
        room = _get_room(db, room_code)
        access_token = token_data.get("access_token", "")
        refresh_token = token_data.get("refresh_token") or room.host_spotify_refresh_token
        user = await spotify.get_current_user(access_token)
        display_name = user.get("display_name") or user.get("id") or "Spotify User"

        if mode == "host":
            if not refresh_token:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Spotify did not return a refresh token. Try reconnecting with consent.",
                )

            room.host_spotify_user_id = user.get("id")
            room.host_spotify_display_name = display_name
            room.host_spotify_refresh_token = refresh_token

            if not room.spotify_playlist_id:
                playlist = await spotify.create_playlist(
                    access_token=access_token,
                    user_id=user["id"],
                    name=f"{room.name} 신청곡",
                    description=f"{room.name} 방에서 함께 채우는 신청곡 플레이리스트",
                )
                images = playlist.get("images") or []
                room.spotify_playlist_id = playlist.get("id")
                room.spotify_playlist_name = playlist.get("name")
                room.spotify_playlist_url = (playlist.get("external_urls") or {}).get("spotify")
                room.spotify_playlist_image_url = images[0].get("url") if images else None

            db.commit()
            return _success_html(
                "방장 Spotify 연결 완료",
                f"<strong>{escape(room.name)}</strong> 방의 신청곡은 이제 방장 플레이리스트에 바로 추가됩니다.",
            )

        if mode == "share":
            playlists = await spotify.get_user_playlists(access_token, limit=8)
            saved = 0
            for item in playlists:
                data = _playlist_payload(item)
                if not data["playlist_id"]:
                    continue
                existing = (
                    db.query(SharedPlaylistORM)
                    .filter(
                        SharedPlaylistORM.room_id == room.id,
                        SharedPlaylistORM.playlist_id == data["playlist_id"],
                    )
                    .first()
                )
                target = existing or SharedPlaylistORM(room_id=room.id, playlist_id=data["playlist_id"])
                target.owner_spotify_user_id = user.get("id")
                target.owner_name = display_name
                target.name = data["name"]
                target.description = data["description"]
                target.image_url = data["image_url"]
                target.external_url = data["external_url"]
                target.track_count = data["track_count"]
                if existing is None:
                    db.add(target)
                saved += 1
            db.commit()
            return _success_html(
                "플레이리스트 공유 완료",
                f"<strong>{escape(room.name)}</strong> 방에 {saved}개의 플레이리스트를 공유했습니다.",
            )

    refresh_token = escape(token_data.get("refresh_token", ""))
    access_token = escape(token_data.get("access_token", ""))
    html = f"""
    <html>
      <head><title>Spotify Connected</title></head>
      <body style="font-family: system-ui; max-width: 720px; margin: 48px auto; line-height: 1.5;">
        <h1>Spotify 연결 완료</h1>
        <p>아래 refresh token을 GitHub Secret 또는 서버 .env의 <code>SPOTIFY_REFRESH_TOKEN</code>에 넣으세요.</p>
        <label>SPOTIFY_REFRESH_TOKEN</label>
        <textarea style="width: 100%; min-height: 120px;">{refresh_token}</textarea>
        <p>임시 access token도 발급되었습니다. refresh token 설정 후에는 저장하지 않아도 됩니다.</p>
        <textarea style="width: 100%; min-height: 90px;">{access_token}</textarea>
      </body>
    </html>
    """
    return HTMLResponse(html)


async def _search_tracks(query: str) -> list[Track]:
    clean = query.strip()
    if clean and spotify.can_search():
        try:
            spotify_tracks = await spotify.search_tracks(clean)
            if spotify_tracks is not None:
                return spotify_tracks
        except Exception:
            return store.search_tracks(clean)

    return store.search_tracks(clean)


@app.get("/api/venue", response_model=Venue)
def get_venue(db: Session = Depends(get_db)) -> Venue:
    room = db.query(RoomORM).order_by(RoomORM.created_at.desc()).first()
    if room is None:
        return Venue(
            name="Codex Cafe",
            description="QR 신청곡을 테스트하는 데모 공간",
            now_playing=store.now_playing,
            queue_size=store.stats()["pending"],
        )

    count = db.query(func.count(SongRequestORM.id)).filter(SongRequestORM.room_id == room.id).scalar() or 0
    return Venue(
        name=room.name,
        description="방장 Spotify 플레이리스트에 함께 신청곡을 추가하는 공간",
        now_playing=DEMO_TRACKS[0],
        queue_size=count,
    )


@app.get("/api/tracks/search", response_model=list[Track])
async def search_tracks(q: str = Query(default="")) -> list[Track]:
    return await _search_tracks(q)


@app.post("/api/requests", response_model=SongRequest, status_code=status.HTTP_201_CREATED)
def create_song_request(payload: CreateSongRequest) -> SongRequest:
    return store.create_request(payload.track, payload.requester_name)


@app.get("/api/requests", response_model=list[SongRequest])
def list_song_requests(status_filter: RequestStatus | None = Query(default=None, alias="status")) -> list[SongRequest]:
    return store.list_requests(status_filter)


@app.get("/api/admin/stats")
def admin_stats(_: None = Depends(require_admin)) -> dict[str, int]:
    return store.stats()


@app.post("/api/admin/requests/{request_id}/approve", response_model=AdminActionResponse)
async def approve_song_request(
    request_id: str,
    _: None = Depends(require_admin),
) -> AdminActionResponse:
    request = store.approve(request_id)
    if request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")

    spotify_result = await spotify.add_to_playlist(request.track)
    return AdminActionResponse(request=request, spotify=spotify_result)


@app.delete("/api/admin/requests/{request_id}", response_model=SongRequest)
def reject_song_request(
    request_id: str,
    _: None = Depends(require_admin),
) -> SongRequest:
    request = store.reject(request_id)
    if request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")

    return request
