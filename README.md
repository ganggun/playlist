# Playlist Request Prototype

QR로 접속한 사용자가 곡을 검색해 신청하고, 운영자가 승인하면 플레이리스트에 반영하는 수업 프로젝트용 MVP입니다.

## 구조

- `frontend`: Expo 기반 React Native 앱
- `backend`: FastAPI 기반 API 서버

## 빠른 실행

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API 확인:

```bash
curl http://localhost:8000/health
```

### Frontend

```bash
cd frontend
npm install
npm run start
```

휴대폰 Expo Go에서 테스트할 때는 `frontend/.env`에 서버 LAN 주소를 넣으세요.

```bash
EXPO_PUBLIC_API_URL=http://192.168.0.10:8000
```

## Spotify 연동 메모

기본값은 데모 모드입니다. 실제 Spotify 검색/플레이리스트 추가를 연결하려면 `backend/.env.example`을 복사해 `backend/.env`를 만들고 값을 채우면 됩니다.

- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`: 검색 API용 Client Credentials
- `SPOTIFY_REDIRECT_URI`: `https://supdobby.me:<외부 HTTPS 포트>/api/auth/spotify/callback`
- `SPOTIFY_REFRESH_TOKEN`: `/api/auth/spotify/login`으로 로그인 후 콜백 화면에서 발급받은 refresh token
- `SPOTIFY_ACCESS_TOKEN`: refresh token을 쓰지 않을 때만 넣는 임시 사용자 토큰
- `SPOTIFY_PLAYLIST_ID`: 승인된 곡을 추가할 대상 플레이리스트

배포 후 `https://supdobby.me:<외부 HTTPS 포트>/api/auth/spotify/login`에 접속하면 Spotify 권한 승인 화면으로 이동합니다.

## Docker

로컬에서 이미지를 직접 빌드할 수 있습니다.

```bash
docker build -f backend/Dockerfile -t playlist-backend .
docker build -f frontend/Dockerfile -t playlist-frontend .
```

프로덕션 compose 기본 구조는 `deploy/docker-compose.yml`에 있습니다.

- `playlist-frontend`: `127.0.0.1:${APP_HOST_PORT:-19520}`에만 바인딩
- `playlist-backend`: Docker network 내부에서만 노출
- host nginx가 외부 HTTPS 포트를 받고 frontend 컨테이너로 프록시

nginx 설정은 서버에서 아래처럼 한 번 실행하면 됩니다.

```bash
cd /home/ganggun0113/apps/playlist-request
PUBLIC_SSL_PORT=9520 APP_HOST_PORT=19520 ./setup-nginx.sh
```

외부 라우터 포워딩은 `외부 HTTPS 포트 -> 172.30.1.56:<같은 포트>` 구조가 필요합니다.

## CI/CD

`.github/workflows/deploy.yml`은 `main` 브랜치 push 시 다음 작업을 수행합니다.

1. backend Docker 이미지 빌드 및 GitHub Container Registry push
2. frontend Docker 이미지 빌드 및 GitHub Container Registry push
3. SSH로 홈서버 접속
4. `/home/ganggun0113/apps/playlist-request`에 compose/env 작성
5. `docker compose pull && docker compose up -d`

GitHub Secrets:

```text
SERVER_HOST=59.25.222.247
SERVER_PORT=2222
SERVER_USER=ganggun0113
SERVER_PASSWORD
APP_HOST_PORT=19520
PUBLIC_SSL_PORT=9520
USE_SPOTIFY_SEARCH=true
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
SPOTIFY_REDIRECT_URI
SPOTIFY_REFRESH_TOKEN
SPOTIFY_ACCESS_TOKEN
SPOTIFY_PLAYLIST_ID
```

`SPOTIFY_ACCESS_TOKEN`은 refresh token 방식으로 운영하면 비워도 됩니다.

현재 workflow는 실수로 `SPORTIFY_ID`, `SPORTIFY_SECRET` 이름으로 만든 Secret도 fallback으로 읽습니다. 나중에는 `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`으로 맞추는 것이 좋습니다.

이미지는 Docker Hub가 아니라 GitHub Container Registry를 씁니다.

```text
ghcr.io/ganggun/playlist-backend:latest
ghcr.io/ganggun/playlist-frontend:latest
```
