from html import escape

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse

from .config import settings
from .models import AdminActionResponse, CreateSongRequest, RequestStatus, SongRequest, Track, Venue
from .spotify import spotify
from .store import store


app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    if settings.admin_token and x_admin_token != settings.admin_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin token")


@app.get("/")
def root() -> dict[str, str]:
    return {"name": settings.app_name, "status": "ok"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/venue", response_model=Venue)
def get_venue() -> Venue:
    stats = store.stats()
    return Venue(
        name="Codex Cafe",
        description="QR 신청곡을 테스트하는 데모 공간",
        now_playing=store.now_playing,
        queue_size=stats["pending"],
    )


@app.get("/api/tracks/search", response_model=list[Track])
async def search_tracks(q: str = Query(default="")) -> list[Track]:
    query = q.strip()
    if query and spotify.can_search():
        try:
            spotify_tracks = await spotify.search_tracks(query)
            if spotify_tracks is not None:
                return spotify_tracks
        except Exception:
            return store.search_tracks(query)

    return store.search_tracks(query)


@app.get("/api/auth/spotify/login")
def spotify_login() -> RedirectResponse:
    try:
        return RedirectResponse(spotify.build_authorize_url())
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get("/api/auth/spotify/callback", response_class=HTMLResponse)
async def spotify_callback(code: str | None = None, error: str | None = None) -> HTMLResponse:
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
