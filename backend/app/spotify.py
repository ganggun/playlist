import base64
from typing import Any
from urllib.parse import urlencode

import httpx

from .config import settings
from .models import Track


SPOTIFY_LANGUAGE_HEADER = "ko-KR,ko;q=0.9,en;q=0.7"


class SpotifyAuthError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


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
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept-Language": SPOTIFY_LANGUAGE_HEADER,
        }

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
        if not uri.startswith("spotify:track:") or track.id.startswith("demo-"):
            raise SpotifyAuthError("Spotify에 추가할 수 없는 데모/잘못된 트랙입니다. 다시 검색해서 실제 Spotify 곡을 선택하세요.")

        headers = {"Authorization": f"Bearer {user_token}"}
        payload = {"uris": [uri]}

        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"https://api.spotify.com/v1/playlists/{target_playlist_id}/items",
                headers=headers,
                json=payload,
            )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = self._api_error_message(
                response,
                "Spotify playlist add failed",
                forbidden_hint="방장 Spotify 계정이 이 플레이리스트를 수정할 권한이 없습니다. 방 탭에서 방장 Spotify를 다시 연결하거나 방장이 수정 가능한 플레이리스트를 선택하세요.",
            )
            raise SpotifyAuthError(detail, status_code=response.status_code) from exc

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
        name: str,
        description: str,
    ) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {access_token}"}
        payload = {"name": name, "description": description, "public": False}
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                "https://api.spotify.com/v1/me/playlists",
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

    async def get_playlist(
        self,
        playlist_id: str,
        access_token: str | None = None,
        refresh_token: str | None = None,
    ) -> dict[str, Any]:
        token = access_token or await self._get_user_token(refresh_token) or await self._get_app_token()
        if not token:
            raise SpotifyAuthError("Spotify token is empty")

        headers = {
            "Authorization": f"Bearer {token}",
            "Accept-Language": SPOTIFY_LANGUAGE_HEADER,
        }
        params = {"fields": "id,name,description,images,external_urls,tracks(total),owner"}
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"https://api.spotify.com/v1/playlists/{playlist_id}",
                headers=headers,
                params=params,
            )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = self._api_error_message(
                response,
                "Spotify playlist request failed",
                forbidden_hint="이 플레이리스트 정보를 읽을 권한이 없습니다. 비공개 플레이리스트라면 해당 Spotify 계정으로 다시 연결하세요.",
            )
            raise SpotifyAuthError(detail, status_code=response.status_code) from exc
        return response.json()

    async def get_playlist_tracks(
        self,
        playlist_id: str,
        access_token: str | None = None,
        refresh_token: str | None = None,
        max_items: int = 50,
    ) -> list[Track]:
        token = access_token or await self._get_user_token(refresh_token) or await self._get_app_token()
        if not token:
            raise SpotifyAuthError("Spotify token is empty")

        headers = {
            "Authorization": f"Bearer {token}",
            "Accept-Language": SPOTIFY_LANGUAGE_HEADER,
        }
        params = {
            "limit": min(max_items, 100),
            "offset": 0,
            "fields": "items(track(id,name,uri,duration_ms,album(name,images),artists(name))),next",
            "market": "KR",
        }
        tracks: list[Track] = []
        async with httpx.AsyncClient(timeout=10) as client:
            while len(tracks) < max_items:
                response = await client.get(
                    f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks",
                    headers=headers,
                    params=params,
                )
                try:
                    response.raise_for_status()
                except httpx.HTTPStatusError as exc:
                    detail = self._api_error_message(
                        response,
                        "Spotify playlist tracks request failed",
                        forbidden_hint="이 플레이리스트의 곡 목록을 읽을 권한이 없습니다. 비공개 플레이리스트라면 공유 탭에서 해당 Spotify 계정으로 다시 공유하세요.",
                    )
                    raise SpotifyAuthError(detail, status_code=response.status_code) from exc

                data = response.json()
                for item in data.get("items", []):
                    track = self._parse_playlist_track(item.get("track") or {})
                    if track:
                        tracks.append(track)
                    if len(tracks) >= max_items:
                        break

                if not data.get("next") or len(tracks) >= max_items:
                    break
                params["offset"] += params["limit"]

        return tracks

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
        headers = {
            "Authorization": f"Basic {encoded}",
            "Content-Type": "application/x-www-form-urlencoded",
        }

        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                "https://accounts.spotify.com/api/token",
                headers=headers,
                data=payload,
            )

        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = self._token_error_message(response)
            raise SpotifyAuthError(detail, status_code=response.status_code) from exc

        return response.json()

    @staticmethod
    def _token_error_message(response: httpx.Response) -> str:
        try:
            data = response.json()
        except ValueError:
            return f"Spotify token request failed with status {response.status_code}"

        error = data.get("error")
        description = data.get("error_description")
        if isinstance(error, dict):
            status = error.get("status", response.status_code)
            message = error.get("message", "Spotify token request failed")
            return f"Spotify token request failed ({status}): {message}"

        if error and description:
            return f"{error}: {description}"
        if error:
            return str(error)
        return f"Spotify token request failed with status {response.status_code}"

    @staticmethod
    def _api_error_message(
        response: httpx.Response,
        fallback: str,
        forbidden_hint: str | None = None,
    ) -> str:
        try:
            data = response.json()
        except ValueError:
            return f"{fallback} with status {response.status_code}"

        error = data.get("error") if isinstance(data, dict) else None
        if isinstance(error, dict):
            status = error.get("status", response.status_code)
            message = error.get("message", fallback)
            if response.status_code == 403 and forbidden_hint:
                return f"Spotify API error ({status}): {message}. {forbidden_hint}"
            return f"Spotify API error ({status}): {message}"
        if error:
            return f"Spotify API error ({response.status_code}): {error}"
        return f"{fallback} with status {response.status_code}"

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

    @staticmethod
    def _parse_playlist_track(item: dict[str, Any]) -> Track | None:
        track_id = item.get("id")
        name = item.get("name")
        if not track_id or not name:
            return None

        album = item.get("album") or {}
        images = album.get("images") or []
        artists = item.get("artists") or []
        return Track(
            id=track_id,
            name=name,
            artists=[artist.get("name", "") for artist in artists if artist.get("name")],
            album=album.get("name") or "",
            image_url=images[0].get("url") if images else None,
            duration_ms=item.get("duration_ms"),
            spotify_uri=item.get("uri"),
        )


spotify = SpotifyClient()
