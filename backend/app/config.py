from dataclasses import dataclass
import os

from dotenv import load_dotenv


load_dotenv()


def _truthy(value: str | None) -> bool:
    return str(value).lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "Playlist Request Prototype")
    admin_token: str = os.getenv("ADMIN_TOKEN", "")
    use_spotify_search: bool = _truthy(os.getenv("USE_SPOTIFY_SEARCH"))
    spotify_client_id: str = os.getenv("SPOTIFY_CLIENT_ID", "")
    spotify_client_secret: str = os.getenv("SPOTIFY_CLIENT_SECRET", "")
    spotify_redirect_uri: str = os.getenv("SPOTIFY_REDIRECT_URI", "")
    spotify_refresh_token: str = os.getenv("SPOTIFY_REFRESH_TOKEN", "")
    spotify_access_token: str = os.getenv("SPOTIFY_ACCESS_TOKEN", "")
    spotify_playlist_id: str = os.getenv("SPOTIFY_PLAYLIST_ID", "")
    spotify_scope: str = os.getenv(
        "SPOTIFY_SCOPE",
        "playlist-modify-public playlist-modify-private",
    )


settings = Settings()
