from datetime import datetime
from threading import Lock

from .models import RequestStatus, SongRequest, Track


DEMO_TRACKS = [
    Track(
        id="demo-ditto",
        name="Ditto",
        artists=["NewJeans"],
        album="OMG",
        duration_ms=185506,
        spotify_uri="spotify:track:demo-ditto",
    ),
    Track(
        id="demo-supernova",
        name="Supernova",
        artists=["aespa"],
        album="Armageddon",
        duration_ms=178000,
        spotify_uri="spotify:track:demo-supernova",
    ),
    Track(
        id="demo-seven",
        name="Seven",
        artists=["Jung Kook", "Latto"],
        album="Seven",
        duration_ms=183550,
        spotify_uri="spotify:track:demo-seven",
    ),
    Track(
        id="demo-night-dancer",
        name="NIGHT DANCER",
        artists=["imase"],
        album="NIGHT DANCER",
        duration_ms=210000,
        spotify_uri="spotify:track:demo-night-dancer",
    ),
    Track(
        id="demo-good-4-u",
        name="good 4 u",
        artists=["Olivia Rodrigo"],
        album="SOUR",
        duration_ms=178146,
        spotify_uri="spotify:track:demo-good-4-u",
    ),
    Track(
        id="demo-lemon",
        name="Lemon",
        artists=["Kenshi Yonezu"],
        album="STRAY SHEEP",
        duration_ms=255000,
        spotify_uri="spotify:track:demo-lemon",
    ),
]


class RequestStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._requests: list[SongRequest] = []
        self.now_playing = DEMO_TRACKS[0]

    def search_tracks(self, query: str) -> list[Track]:
        normalized = query.strip().lower()
        if not normalized:
            return DEMO_TRACKS

        return [
            track
            for track in DEMO_TRACKS
            if normalized in track.name.lower()
            or any(normalized in artist.lower() for artist in track.artists)
            or normalized in track.album.lower()
        ]

    def create_request(self, track: Track, requester_name: str) -> SongRequest:
        clean_name = requester_name.strip() or "익명"
        request = SongRequest(track=track, requester_name=clean_name)

        with self._lock:
            self._requests.insert(0, request)

        return request

    def list_requests(self, status: RequestStatus | None = None) -> list[SongRequest]:
        with self._lock:
            rows = list(self._requests)

        if status is None:
            return rows

        return [request for request in rows if request.status == status]

    def approve(self, request_id: str) -> SongRequest | None:
        with self._lock:
            approved_count = sum(
                1 for request in self._requests if request.status == RequestStatus.approved
            )

            for request in self._requests:
                if request.id == request_id:
                    request.status = RequestStatus.approved
                    request.approved_at = datetime.utcnow()
                    request.playback_order = approved_count + 1
                    return request

        return None

    def reject(self, request_id: str) -> SongRequest | None:
        with self._lock:
            for request in self._requests:
                if request.id == request_id:
                    request.status = RequestStatus.rejected
                    return request

        return None

    def stats(self) -> dict[str, int]:
        with self._lock:
            return {
                "pending": sum(1 for item in self._requests if item.status == RequestStatus.pending),
                "approved": sum(1 for item in self._requests if item.status == RequestStatus.approved),
                "rejected": sum(1 for item in self._requests if item.status == RequestStatus.rejected),
                "total": len(self._requests),
            }


store = RequestStore()

