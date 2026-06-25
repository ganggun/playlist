import base64
from typing import Any
from urllib.parse import urlencode

import httpx

from .config import settings
from .models import Track


class SpotifyClient:
    def __init__(self) -> None:
        self._app_token: str | None = None
        self._user_token: str | None = None

    def can_search(self) -> bool:
        return bool(
            settings.use_spotify_search
            and settings.spotify_client_id
            and settings.spotify_client_secret
        )

    async def _get_app_token(self) -> str | None:
        if self._app_token:
            return self._app_token

        credentials = f"{settings.spotify_client_id}:{settings.spotify_client_secret}"
        encoded = base64.b64encode(credentials.encode()).decode()
        headers = {"Authorization": f"Basic {encoded}"}
        data = {"grant_type": "client_credentials"}

        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                "https://accounts.spotify.com/api/token",
                headers=headers,
                data=data,
            )
            response.raise_for_status()

        self._app_token = response.json()["access_token"]
        return self._app_token

    async def search_tracks(self, query: str) -> list[Track] | None:
        if not self.can_search():
            return None

        token = await self._get_app_token()
        if not token:
            return None

        params = {"q": query, "type": "track", "limit": 10, "market": "KR"}
        headers = {"Authorization": f"Bearer {token}"}

        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                "https://api.spotify.com/v1/search",
                params=params,
                headers=headers,
            )
            response.raise_for_status()

        items = response.json().get("tracks", {}).get("items", [])
        return [self._parse_track(item) for item in items]

    def build_authorize_url(self) -> str:
        if not settings.spotify_client_id or not settings.spotify_redirect_uri:
            raise ValueError("Spotify client id or redirect uri is empty")

        return self.build_scoped_authorize_url(scope=settings.spotify_scope)

    def build_scoped_authorize_url(self, scope: str, state: str | None = None) -> str:
        if not settings.spotify_client_id or not settings.spotify_redirect_uri:
            raise ValueError("Spotify client id or redirect uri is empty")

        params = {
            "client_id": settings.spotify_client_id,
            "response_type": "code",
            "redirect_uri": settings.spotify_redirect_uri,
            "scope": scope,
            "show_dialog": "true",
        }
        if state:
            params["state"] = state
        return f"https://accounts.spotify.com/authorize?{urlencode(params)}"

    async def exchange_code(self, code: str) -> dict[str, Any]:
        if not settings.spotify_client_id or not settings.spotify_client_secret:
            raise ValueError("Spotify client credentials are empty")

        payload = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.spotify_redirect_uri,
        }
        return await self._token_request(payload)

    async def add_to_playlist(
        self,
        track: Track,
        refresh_token: str | None = None,
        playlist_id: str | None = None,
    ) -> dict[str, Any]:
        user_token = await self._get_user_token(refresh_token)
        target_playlist_id = playlist_id or settings.spotify_playlist_id
        if not user_token or not target_playlist_id:
            return {"mode": "demo", "added": False, "reason": "Spotify token or playlist id is empty"}

        uri = track.spotify_uri or f"spotify:track:{track.id}"
        headers = {"Authorization": f"Bearer {user_token}"}
        payload = {"uris": [uri]}

        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"https://api.spotify.com/v1/playlists/{target_playlist_id}/tracks",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()

        return {"mode": "spotify", "added": True, "snapshot_id": response.json().get("snapshot_id")}

    async def get_current_user(self, access_token: str) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {access_token}"}
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get("https://api.spotify.com/v1/me", headers=headers)
            response.raise_for_status()
        return response.json()

    async def create_playlist(
        self,
        access_token: str,
        user_id: str,
        name: str,
        description: str,
    ) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {access_token}"}
        payload = {"name": name, "description": description, "public": False}
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"https://api.spotify.com/v1/users/{user_id}/playlists",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
        return response.json()

    async def get_user_playlists(self, access_token: str, limit: int = 8) -> list[dict[str, Any]]:
        headers = {"Authorization": f"Bearer {access_token}"}
        params = {"limit": limit}
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                "https://api.spotify.com/v1/me/playlists",
                headers=headers,
                params=params,
            )
            response.raise_for_status()
        return response.json().get("items", [])

    async def _get_user_token(self, refresh_token: str | None = None) -> str | None:
        if refresh_token:
            token_data = await self._token_request(
                {
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                }
            )
            return token_data.get("access_token")

        if self._user_token:
            return self._user_token

        if settings.spotify_access_token:
            return settings.spotify_access_token

        if not settings.spotify_refresh_token:
            return None

        payload = {
            "grant_type": "refresh_token",
            "refresh_token": settings.spotify_refresh_token,
        }
        token_data = await self._token_request(payload)
        self._user_token = token_data.get("access_token")
        return self._user_token

    async def _token_request(self, payload: dict[str, str]) -> dict[str, Any]:
        credentials = f"{settings.spotify_client_id}:{settings.spotify_client_secret}"
        encoded = base64.b64encode(credentials.encode()).decode()
        headers = {"Authorization": f"Basic {encoded}"}

        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                "https://accounts.spotify.com/api/token",
                headers=headers,
                data=payload,
            )
            response.raise_for_status()

        return response.json()

    @staticmethod
    def _parse_track(item: dict[str, Any]) -> Track:
        images = item.get("album", {}).get("images", [])
        return Track(
            id=item["id"],
            name=item["name"],
            artists=[artist["name"] for artist in item.get("artists", [])],
            album=item.get("album", {}).get("name", ""),
            image_url=images[0]["url"] if images else None,
            duration_ms=item.get("duration_ms"),
            spotify_uri=item.get("uri"),
        )


spotify = SpotifyClient()
