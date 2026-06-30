from dataclasses import dataclass
import os
from urllib.parse import urlparse

from dotenv import load_dotenv


load_dotenv()


def _truthy(value: str | None) -> bool:
    return str(value).lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "Room Playlist")
    admin_token: str = os.getenv("ADMIN_TOKEN", "")
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./playlist.db")
    public_app_url: str = os.getenv("PUBLIC_APP_URL", "")
    use_spotify_search: bool = _truthy(os.getenv("USE_SPOTIFY_SEARCH"))
    spotify_client_id: str = os.getenv("SPOTIFY_CLIENT_ID", "")
    spotify_client_secret: str = os.getenv("SPOTIFY_CLIENT_SECRET", "")
    spotify_redirect_uri: str = os.getenv("SPOTIFY_REDIRECT_URI", "")
    spotify_refresh_token: str = os.getenv("SPOTIFY_REFRESH_TOKEN", "")
    spotify_access_token: str = os.getenv("SPOTIFY_ACCESS_TOKEN", "")
    spotify_playlist_id: str = os.getenv("SPOTIFY_PLAYLIST_ID", "")
    spotify_scope: str = os.getenv(
        "SPOTIFY_SCOPE",
        "playlist-modify-public playlist-modify-private playlist-read-private playlist-read-collaborative user-read-private user-read-currently-playing",
    )

    @property
    def resolved_public_app_url(self) -> str:
        if self.public_app_url:
            return self.public_app_url.rstrip("/")

        if self.spotify_redirect_uri:
            parsed = urlparse(self.spotify_redirect_uri)
            if parsed.scheme and parsed.netloc:
                return f"{parsed.scheme}://{parsed.netloc}"

        return "http://localhost:8081"


settings = Settings()
