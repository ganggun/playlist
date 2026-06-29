import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";

const DEFAULT_API_URL = Platform.OS === "web" ? "http://localhost:8000" : "http://10.0.2.2:8000";
const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL).replace(/\/$/, "");

const tabs = [
  { key: "search", label: "신청곡" },
  { key: "room", label: "방" },
  { key: "share", label: "공유" }
];

export default function App() {
  const { width } = useWindowDimensions();
  const isWide = width >= 980;
  const [room, setRoom] = useState(null);
  const [activeTab, setActiveTab] = useState("search");
  const [roomCode, setRoomCode] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [query, setQuery] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [tracks, setTracks] = useState([]);
  const [requests, setRequests] = useState([]);
  const [sharedPlaylists, setSharedPlaylists] = useState([]);
  const [expandedPlaylistId, setExpandedPlaylistId] = useState("");
  const [playlistTracks, setPlaylistTracks] = useState({});
  const [trackLoadingId, setTrackLoadingId] = useState("");
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const latestRequests = useMemo(() => requests.slice(0, 8), [requests]);

  async function api(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      },
      ...options
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed: ${response.status}`);
    }

    return response.json();
  }

  async function loadRoom(code = room?.code) {
    if (!code) return;
    setError("");
    const normalized = code.trim().toUpperCase();
    const [nextRoom, nextRequests, nextShared, nextStats] = await Promise.all([
      api(`/api/rooms/${normalized}`),
      api(`/api/rooms/${normalized}/requests`),
      api(`/api/rooms/${normalized}/shared-playlists`),
      api(`/api/rooms/${normalized}/stats`)
    ]);
    setRoom(nextRoom);
    setRoomCode(normalized);
    setRequests(nextRequests);
    setSharedPlaylists(nextShared);
    setStats(nextStats);
    rememberRoom(normalized);
  }

  async function joinRoom() {
    if (!roomCode.trim()) return;
    setLoading(true);
    setError("");
    try {
      await loadRoom(roomCode);
    } catch (err) {
      setError("방을 찾지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function createRoom() {
    if (!newRoomName.trim()) {
      setError("방 이름을 입력하세요.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const created = await api("/api/rooms", {
        method: "POST",
        body: JSON.stringify({
          name: newRoomName.trim()
        })
      });
      setRoom(created);
      setRoomCode(created.code);
      rememberRoom(created.code);
      await loadRoom(created.code);
      setNotice("방이 생성되었습니다. 방장 Spotify를 연결하세요.");
    } catch (err) {
      setError("방을 만들지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function searchTracks(nextQuery = query) {
    if (!room) return;
    setLoading(true);
    setError("");
    try {
      const data = await api(`/api/rooms/${room.code}/tracks/search?q=${encodeURIComponent(nextQuery)}`);
      setTracks(data);
    } catch (err) {
      setError("곡 검색에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshRoomSpotify(code = room?.code) {
    if (!code) return;
    setLoading(true);
    setError("");
    try {
      const normalized = code.trim().toUpperCase();
      const currentRoom = room?.code === normalized ? room : await api(`/api/rooms/${normalized}`);
      if (currentRoom?.spotify_connected) {
        await api(`/api/rooms/${normalized}/spotify/refresh`, { method: "POST" });
      }
      await loadRoom(normalized);
    } catch (err) {
      setError("방 정보를 갱신하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function addTrack(track) {
    if (!room) return;
    setBusyId(track.id);
    setNotice("");
    setError("");
    try {
      const created = await api(`/api/rooms/${room.code}/requests`, {
        method: "POST",
        body: JSON.stringify({
          track,
          requester_name: requesterName.trim() || "익명"
        })
      });
      await loadRoom(room.code);
      if (created.status === "added") {
        setNotice("플레이리스트에 추가했습니다.");
      } else if (created.status === "failed") {
        setError(spotifyFailureMessage(created));
      } else {
        setNotice("신청을 저장했습니다. 방장 Spotify 연결 후 자동 추가됩니다.");
      }
    } catch (err) {
      setError("신청을 처리하지 못했습니다.");
    } finally {
      setBusyId("");
    }
  }

  async function openUrl(url) {
    try {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.assign(url);
        return;
      }
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert("열 수 없음", url);
    }
  }

  function openHostLogin() {
    if (room) openUrl(`${API_URL}/api/rooms/${room.code}/spotify/login`);
  }

  async function disconnectHostSpotify() {
    if (!room) return;

    if (
      Platform.OS === "web"
      && typeof window !== "undefined"
      && !window.confirm("방장 Spotify 연결을 끊을까요? 기존 Spotify 플레이리스트 자체는 삭제되지 않습니다.")
    ) {
      return;
    }

    setLoading(true);
    setNotice("");
    setError("");
    try {
      await api(`/api/rooms/${room.code}/spotify`, { method: "DELETE" });
      await loadRoom(room.code);
      setNotice("방장 Spotify 연결을 끊었습니다.");
    } catch (err) {
      setError("방장 Spotify 연결을 끊지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function openShareLogin() {
    if (room) openUrl(`${API_URL}/api/rooms/${room.code}/spotify/share/login`);
  }

  async function toggleSharedPlaylist(playlist) {
    if (!room) return;
    if (expandedPlaylistId === playlist.id) {
      setExpandedPlaylistId("");
      return;
    }

    setExpandedPlaylistId(playlist.id);
    if (playlistTracks[playlist.id]) return;

    setTrackLoadingId(playlist.id);
    setError("");
    try {
      const nextTracks = await api(`/api/rooms/${room.code}/shared-playlists/${playlist.id}/tracks`);
      setPlaylistTracks((current) => ({
        ...current,
        [playlist.id]: nextTracks
      }));
    } catch (err) {
      setError("공유 플레이리스트 곡 목록을 불러오지 못했습니다.");
    } finally {
      setTrackLoadingId("");
    }
  }

  function leaveRoom() {
    setRoom(null);
    setTracks([]);
    setRequests([]);
    setSharedPlaylists([]);
    setExpandedPlaylistId("");
    setPlaylistTracks({});
    setTrackLoadingId("");
    setStats(null);
    setNotice("");
    forgetRoom();
  }

  useEffect(() => {
    const initialCode = getInitialRoomCode();
    if (initialCode) {
      setRoomCode(initialCode);
      loadRoom(initialCode).catch(() => setError("방을 불러오지 못했습니다."));
    }
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={styles.app}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {!room ? (
          <JoinScreen
            roomCode={roomCode}
            setRoomCode={setRoomCode}
            newRoomName={newRoomName}
            setNewRoomName={setNewRoomName}
            loading={loading}
            error={error}
            joinRoom={joinRoom}
            createRoom={createRoom}
          />
        ) : (
          <View style={[styles.shell, !isWide && styles.shellMobile]}>
            {isWide ? (
              <LibraryPanel room={room} requests={latestRequests} leaveRoom={leaveRoom} />
            ) : null}

            <View style={styles.mainPanel}>
              <RoomHero
                room={room}
                stats={stats}
                onRefresh={() => refreshRoomSpotify(room.code)}
                onHostLogin={openHostLogin}
                onOpenPlaylist={() => room.spotify_playlist_url && openUrl(room.spotify_playlist_url)}
              />

              <View style={styles.tabBar}>
                {tabs.map((tab) => (
                  <Pressable
                    key={tab.key}
                    style={[styles.tabButton, activeTab === tab.key && styles.tabButtonActive]}
                    onPress={() => setActiveTab(tab.key)}
                  >
                    <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                      {tab.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {notice ? <Text style={styles.notice}>{notice}</Text> : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}

              {activeTab === "search" ? (
                <SearchTab
                  query={query}
                  setQuery={setQuery}
                  requesterName={requesterName}
                  setRequesterName={setRequesterName}
                  tracks={tracks}
                  loading={loading}
                  busyId={busyId}
                  searchTracks={searchTracks}
                  addTrack={addTrack}
                  requests={requests}
                />
              ) : null}

              {activeTab === "room" ? (
                <RoomTab
                  room={room}
                  stats={stats}
                  requests={requests}
                  onHostLogin={openHostLogin}
                  onHostDisconnect={disconnectHostSpotify}
                  onRefresh={() => refreshRoomSpotify(room.code)}
                  onOpenPlaylist={() => room.spotify_playlist_url && openUrl(room.spotify_playlist_url)}
                />
              ) : null}

              {activeTab === "share" ? (
                <ShareTab
                  sharedPlaylists={sharedPlaylists}
                  openShareLogin={openShareLogin}
                  expandedPlaylistId={expandedPlaylistId}
                  playlistTracks={playlistTracks}
                  trackLoadingId={trackLoadingId}
                  onTogglePlaylist={toggleSharedPlaylist}
                />
              ) : null}
            </View>

            {isWide ? (
              <RightPanel
                room={room}
                stats={stats}
                sharedPlaylists={sharedPlaylists}
                openShareLogin={openShareLogin}
              />
            ) : null}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function JoinScreen({
  roomCode,
  setRoomCode,
  newRoomName,
  setNewRoomName,
  loading,
  error,
  joinRoom,
  createRoom
}) {
  return (
    <ScrollView contentContainerStyle={styles.joinWrap}>
      <View style={styles.brandBlock}>
        <Text style={styles.brandMark}>ROOM PLAYLIST</Text>
        <Text style={styles.joinTitle}>공간의 플레이리스트를 함께 채우세요</Text>
        <Text style={styles.joinSubtitle}>방장 Spotify 계정 하나로 모두가 신청곡을 추가합니다.</Text>
      </View>

      <View style={styles.joinGrid}>
        <View style={styles.joinCard}>
          <Text style={styles.cardTitle}>방 입장</Text>
          <TextInput
            value={roomCode}
            onChangeText={(value) => setRoomCode(value.toUpperCase())}
            placeholder="6자리 코드"
            placeholderTextColor="#6F6F6F"
            autoCapitalize="characters"
            style={styles.input}
            onSubmitEditing={joinRoom}
          />
          <Pressable style={styles.greenButton} onPress={joinRoom} disabled={loading}>
            <Text style={styles.greenButtonText}>{loading ? "확인 중" : "입장"}</Text>
          </Pressable>
        </View>

        <View style={styles.joinCard}>
          <Text style={styles.cardTitle}>방 만들기</Text>
          <TextInput
            value={newRoomName}
            onChangeText={setNewRoomName}
            placeholder="예: 금요일 파티"
            placeholderTextColor="#6F6F6F"
            style={styles.input}
          />
          <Pressable style={styles.secondaryDarkButton} onPress={createRoom} disabled={loading}>
            <Text style={styles.secondaryDarkText}>{loading ? "생성 중" : "생성"}</Text>
          </Pressable>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

function LibraryPanel({ room, requests, leaveRoom }) {
  return (
    <View style={styles.libraryPanel}>
      <View style={styles.libraryHeader}>
        <Text style={styles.panelTitle}>내 방</Text>
        <Pressable style={styles.roundButton} onPress={leaveRoom}>
          <Text style={styles.roundButtonText}>나가기</Text>
        </Pressable>
      </View>
      <View style={styles.libraryItemActive}>
        <AlbumFallback text={room.name} size={52} />
        <View style={styles.flex}>
          <Text style={styles.itemTitle} numberOfLines={1}>{room.name}</Text>
          <Text style={styles.mutedText}>{room.code}</Text>
        </View>
      </View>
      <Text style={styles.panelSubtitle}>최근 신청</Text>
      {requests.length === 0 ? (
        <Text style={styles.emptySideText}>아직 신청곡이 없습니다.</Text>
      ) : (
        requests.map((request) => (
          <View key={request.id} style={styles.libraryItem}>
            <AlbumArt track={request.track} size={46} />
            <View style={styles.flex}>
              <Text style={styles.itemTitle} numberOfLines={1}>{request.track.name}</Text>
              <Text style={styles.mutedText} numberOfLines={1}>{request.track.artists.join(", ")}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function RoomHero({ room, stats, onRefresh, onHostLogin, onOpenPlaylist }) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroArtWrap}>
        {room.spotify_playlist_image_url ? (
          <Image source={{ uri: room.spotify_playlist_image_url }} style={styles.heroArt} />
        ) : (
          <AlbumFallback text={room.name} size={132} />
        )}
      </View>
      <View style={styles.heroCopy}>
        <Text style={styles.heroType}>공유 신청곡 방</Text>
        <Text style={styles.heroTitle} numberOfLines={2}>{room.name}</Text>
        <Text style={styles.heroMeta} numberOfLines={1}>
          {room.host_spotify_display_name || room.host_name} · {room.request_count}곡 · 코드 {room.code}
        </Text>
        <View style={styles.heroActions}>
          <Pressable style={styles.playButton} onPress={onOpenPlaylist}>
            <Text style={styles.playButtonText}>▶</Text>
          </Pressable>
          <Pressable style={styles.pillButton} onPress={onHostLogin}>
            <Text style={styles.pillButtonText}>
              {room.spotify_connected ? "Spotify 연결됨" : "방장 연결"}
            </Text>
          </Pressable>
          <Pressable style={styles.iconPill} onPress={onRefresh}>
            <Text style={styles.iconPillText}>새로고침</Text>
          </Pressable>
        </View>
        {stats ? <Text style={styles.heroInsight} numberOfLines={2}>{stats.insight}</Text> : null}
      </View>
    </View>
  );
}

function SearchTab({
  query,
  setQuery,
  requesterName,
  setRequesterName,
  tracks,
  loading,
  busyId,
  searchTracks,
  addTrack,
  requests
}) {
  return (
    <View style={styles.tabContent}>
      <View style={styles.searchControls}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="어떤 음악을 신청할까요?"
          placeholderTextColor="#8A8A8A"
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={() => searchTracks(query)}
        />
        <TextInput
          value={requesterName}
          onChangeText={setRequesterName}
          placeholder="이름"
          placeholderTextColor="#8A8A8A"
          style={styles.nameInput}
          maxLength={30}
        />
        <Pressable style={styles.greenButtonSmall} onPress={() => searchTracks(query)}>
          <Text style={styles.greenButtonText}>검색</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingArea}>
          <ActivityIndicator color="#1ED760" />
        </View>
      ) : (
        <FlatList
          style={styles.trackScroller}
          data={tracks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.trackList}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={<TrackListHeader />}
          ListEmptyComponent={<Text style={styles.emptyText}>검색 결과가 없습니다.</Text>}
          ListFooterComponent={requests.length ? (
            <RecentRequests requests={requests.slice(0, 5)} />
          ) : null}
          renderItem={({ item, index }) => (
            <TrackRow
              index={index + 1}
              track={item}
              actionLabel={busyId === item.id ? "추가 중" : "추가"}
              disabled={Boolean(busyId)}
              onPress={() => addTrack(item)}
            />
          )}
        />
      )}
    </View>
  );
}

function RecentRequests({ requests }) {
  return (
    <View style={styles.recentBlock}>
      <Text style={styles.sectionTitle}>최근 추가</Text>
      {requests.map((request, index) => (
        <RequestRow key={request.id} request={request} index={index + 1} />
      ))}
    </View>
  );
}

function RoomTab({ room, stats, requests, onHostLogin, onHostDisconnect, onRefresh, onOpenPlaylist }) {
  const qrUrl = `${API_URL}/api/rooms/${room.code}/qr`;
  return (
    <ScrollView contentContainerStyle={styles.tabScroll}>
      <View style={styles.roomGrid}>
        <View style={styles.infoCard}>
          <Text style={styles.cardTitle}>입장 코드</Text>
          <Text style={styles.roomCode}>{room.code}</Text>
          <Image source={{ uri: qrUrl }} style={styles.qrImage} />
        </View>
        <View style={styles.infoCard}>
          <Text style={styles.cardTitle}>Spotify</Text>
          <Text style={styles.itemTitle}>
            {room.spotify_playlist_name || "방장 연결 대기"}
          </Text>
          <Text style={styles.mutedText} numberOfLines={2}>
            {room.spotify_connected ? "신청곡이 이 플레이리스트에 바로 추가됩니다." : "방장이 Spotify를 연결하면 자동 추가가 시작됩니다."}
          </Text>
          <View style={styles.inlineButtons}>
            <Pressable style={styles.greenButtonSmall} onPress={onHostLogin}>
              <Text style={styles.greenButtonText}>{room.spotify_connected ? "변경" : "연결"}</Text>
            </Pressable>
            <Pressable style={styles.secondaryDarkButtonSmall} onPress={onOpenPlaylist}>
              <Text style={styles.secondaryDarkText}>열기</Text>
            </Pressable>
            {room.spotify_connected ? (
              <Pressable style={styles.dangerButtonSmall} onPress={onHostDisconnect}>
                <Text style={styles.dangerButtonText}>연결 끊기</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.secondaryDarkButtonSmall} onPress={onRefresh}>
              <Text style={styles.secondaryDarkText}>갱신</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.sectionTitle}>방 기록</Text>
        <View style={styles.statLine}>
          <Text style={styles.statLabel}>전체 신청</Text>
          <Text style={styles.statValue}>{stats?.total_requests ?? requests.length}</Text>
        </View>
        <View style={styles.statLine}>
          <Text style={styles.statLabel}>Spotify 추가</Text>
          <Text style={styles.statValue}>{stats?.added_requests ?? 0}</Text>
        </View>
        <View style={styles.statLine}>
          <Text style={styles.statLabel}>공유 플레이리스트</Text>
          <Text style={styles.statValue}>{stats?.shared_playlists ?? 0}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

function ShareTab({
  sharedPlaylists,
  openShareLogin,
  expandedPlaylistId,
  playlistTracks,
  trackLoadingId,
  onTogglePlaylist
}) {
  return (
    <ScrollView contentContainerStyle={styles.tabScroll}>
      <View style={styles.shareHeader}>
        <View>
          <Text style={styles.sectionTitle}>공유 플레이리스트</Text>
          <Text style={styles.mutedText}>방 사람들이 좋아하는 플레이리스트</Text>
        </View>
        <Pressable style={styles.greenButtonSmall} onPress={openShareLogin}>
          <Text style={styles.greenButtonText}>내 것 공유</Text>
        </Pressable>
      </View>

      {sharedPlaylists.length === 0 ? (
        <Text style={styles.emptyText}>공유된 플레이리스트가 없습니다.</Text>
      ) : (
        sharedPlaylists.map((playlist) => (
          <SharedPlaylistCard
            key={playlist.id}
            playlist={playlist}
            isOpen={expandedPlaylistId === playlist.id}
            tracks={playlistTracks[playlist.id] || []}
            loading={trackLoadingId === playlist.id}
            onToggle={() => onTogglePlaylist(playlist)}
          />
        ))
      )}
    </ScrollView>
  );
}

function SharedPlaylistCard({ playlist, isOpen, tracks, loading, onToggle }) {
  return (
    <View style={[styles.playlistCard, isOpen && styles.playlistCardOpen]}>
      <Pressable style={styles.playlistCardHeader} onPress={onToggle}>
        {playlist.image_url ? (
          <Image source={{ uri: playlist.image_url }} style={styles.playlistImage} />
        ) : (
          <AlbumFallback text={playlist.name} size={72} />
        )}
        <View style={styles.flex}>
          <Text style={styles.itemTitle} numberOfLines={1}>{playlist.name}</Text>
          <Text style={styles.mutedText} numberOfLines={1}>{playlist.owner_name}</Text>
          <Text style={styles.softText}>{playlist.track_count}곡</Text>
        </View>
        <Text style={styles.chevronText}>{isOpen ? "접기" : "보기"}</Text>
      </Pressable>

      {isOpen ? (
        <View style={styles.sharedTrackList}>
          {loading ? (
            <View style={styles.loadingArea}>
              <ActivityIndicator color="#1ED760" />
            </View>
          ) : tracks.length ? (
            tracks.map((track, index) => (
              <SharedTrackRow key={`${track.id}-${index}`} track={track} index={index + 1} />
            ))
          ) : (
            <Text style={styles.emptyText}>표시할 곡이 없습니다.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

function SharedTrackRow({ track, index }) {
  return (
    <View style={styles.sharedTrackRow}>
      <Text style={styles.trackIndex}>{index}</Text>
      <AlbumArt track={track} size={42} />
      <View style={styles.flex}>
        <Text style={styles.itemTitle} numberOfLines={1}>{track.name}</Text>
        <Text style={styles.mutedText} numberOfLines={1}>{track.artists.join(", ")}</Text>
      </View>
      <Text style={styles.softText}>{formatDuration(track.duration_ms)}</Text>
    </View>
  );
}

function RightPanel({ room, stats, sharedPlaylists, openShareLogin }) {
  const qrUrl = `${API_URL}/api/rooms/${room.code}/qr`;
  return (
    <View style={styles.rightPanel}>
      <Text style={styles.panelTitle}>{room.name}</Text>
      <Image source={{ uri: qrUrl }} style={styles.sideQr} />
      <Text style={styles.sideCode}>{room.code}</Text>

      <View style={styles.sideCard}>
        <Text style={styles.cardTitle}>취향</Text>
        <Text style={styles.insightText}>{stats?.insight || "취향을 모으는 중이에요."}</Text>
        {stats?.top_artists?.map((artist) => (
          <View key={artist.name} style={styles.statLine}>
            <Text style={styles.statLabel}>{artist.name}</Text>
            <Text style={styles.statValue}>{artist.count}</Text>
          </View>
        ))}
      </View>

      <View style={styles.sideCard}>
        <View style={styles.sideCardHeader}>
          <Text style={styles.cardTitle}>공유</Text>
          <Pressable onPress={openShareLogin}>
            <Text style={styles.greenText}>추가</Text>
          </Pressable>
        </View>
        {sharedPlaylists.slice(0, 3).map((playlist) => (
          <View key={playlist.id} style={styles.miniPlaylist}>
            {playlist.image_url ? (
              <Image source={{ uri: playlist.image_url }} style={styles.miniImage} />
            ) : (
              <AlbumFallback text={playlist.name} size={42} />
            )}
            <View style={styles.flex}>
              <Text style={styles.miniTitle} numberOfLines={1}>{playlist.name}</Text>
              <Text style={styles.mutedText} numberOfLines={1}>{playlist.owner_name}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function TrackListHeader() {
  return (
    <View style={styles.tableHeader}>
      <Text style={[styles.tableHeadText, styles.indexCol]}>#</Text>
      <Text style={[styles.tableHeadText, styles.titleCol]}>제목</Text>
      <Text style={[styles.tableHeadText, styles.albumCol]}>앨범</Text>
      <Text style={[styles.tableHeadText, styles.actionCol]}>추가</Text>
    </View>
  );
}

function TrackRow({ index, track, actionLabel, disabled, onPress }) {
  return (
    <View style={styles.trackRow}>
      <Text style={[styles.trackIndex, styles.indexCol]}>{index}</Text>
      <View style={[styles.trackTitleWrap, styles.titleCol]}>
        <AlbumArt track={track} size={52} />
        <View style={styles.flex}>
          <Text style={styles.itemTitle} numberOfLines={1}>{track.name}</Text>
          <Text style={styles.mutedText} numberOfLines={1}>{track.artists.join(", ")}</Text>
        </View>
      </View>
      <Text style={[styles.albumText, styles.albumCol]} numberOfLines={1}>{track.album || "Single"}</Text>
      <Pressable style={[styles.addButton, disabled && styles.disabled]} onPress={onPress} disabled={disabled}>
        <Text style={styles.addButtonText}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

function RequestRow({ request, index }) {
  const failureReason = request.status === "failed" ? spotifyFailureReason(request) : "";
  return (
    <View style={styles.requestRow}>
      <Text style={styles.trackIndex}>{index}</Text>
      <AlbumArt track={request.track} size={44} />
      <View style={styles.flex}>
        <Text style={styles.itemTitle} numberOfLines={1}>{request.track.name}</Text>
        <Text style={styles.mutedText} numberOfLines={1}>
          {request.track.artists.join(", ")} · {request.requester_name}
        </Text>
        {failureReason ? (
          <Text style={styles.failureReason} numberOfLines={2}>{failureReason}</Text>
        ) : null}
      </View>
      <Text style={request.status === "added" ? styles.statusAdded : styles.statusQueued}>
        {request.status === "added" ? "추가됨" : request.status === "failed" ? "실패" : "대기"}
      </Text>
    </View>
  );
}

function AlbumArt({ track, size }) {
  if (track?.image_url) {
    return <Image source={{ uri: track.image_url }} style={[styles.albumArt, { width: size, height: size }]} />;
  }
  return <AlbumFallback text={track?.name || "P"} size={size} />;
}

function AlbumFallback({ text, size }) {
  return (
    <View style={[styles.albumFallback, { width: size, height: size }]}>
      <Text style={[styles.albumFallbackText, { fontSize: Math.max(16, size / 3) }]}>
        {(text || "P").slice(0, 1)}
      </Text>
    </View>
  );
}

function getInitialRoomCode() {
  if (Platform.OS !== "web" || typeof window === "undefined") return "";
  const fromQuery = new URLSearchParams(window.location.search).get("room");
  return (fromQuery || window.localStorage.getItem("playlist-room-code") || "").toUpperCase();
}

function rememberRoom(code) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.localStorage.setItem("playlist-room-code", code);
  }
}

function forgetRoom() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.localStorage.removeItem("playlist-room-code");
  }
}

function spotifyFailureReason(request) {
  const reason = request?.spotify?.reason;
  if (!reason || typeof reason !== "string") return "";
  return reason.length > 180 ? `${reason.slice(0, 180)}...` : reason;
}

function spotifyFailureMessage(request) {
  const reason = spotifyFailureReason(request);
  return reason
    ? `신청은 저장했지만 Spotify 추가에 실패했습니다. 사유: ${reason}`
    : "신청은 저장했지만 Spotify 추가에 실패했습니다.";
}

function formatDuration(durationMs) {
  if (!durationMs) return "";
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#000000"
  },
  app: {
    flex: 1,
    backgroundColor: "#000000"
  },
  shell: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    padding: 8
  },
  shellMobile: {
    flexDirection: "column",
    padding: 0
  },
  joinWrap: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "#000000"
  },
  brandBlock: {
    maxWidth: 760,
    marginBottom: 28
  },
  brandMark: {
    color: "#1ED760",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 10
  },
  joinTitle: {
    color: "#FFFFFF",
    fontSize: 42,
    fontWeight: "900"
  },
  joinSubtitle: {
    color: "#B3B3B3",
    fontSize: 16,
    marginTop: 10
  },
  joinGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14
  },
  joinCard: {
    backgroundColor: "#121212",
    borderRadius: 8,
    padding: 18,
    width: 340,
    maxWidth: "100%",
    gap: 12
  },
  libraryPanel: {
    width: 320,
    backgroundColor: "#121212",
    borderRadius: 8,
    padding: 16
  },
  mainPanel: {
    flex: 1,
    backgroundColor: "#121212",
    borderRadius: 8,
    overflow: "hidden",
    minHeight: 0
  },
  rightPanel: {
    width: 300,
    backgroundColor: "#121212",
    borderRadius: 8,
    padding: 16,
    gap: 14
  },
  libraryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16
  },
  panelTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900"
  },
  panelSubtitle: {
    color: "#B3B3B3",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 8,
    marginTop: 18
  },
  libraryItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8
  },
  libraryItemActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#2A2A2A",
    borderRadius: 6,
    padding: 8
  },
  hero: {
    minHeight: 260,
    backgroundColor: "#9A2500",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 24,
    padding: 28
  },
  heroArtWrap: {
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 16
  },
  heroArt: {
    width: 132,
    height: 132,
    borderRadius: 6,
    backgroundColor: "#282828"
  },
  heroCopy: {
    flex: 1,
    minWidth: 0
  },
  heroType: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 8
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 52,
    fontWeight: "900"
  },
  heroMeta: {
    color: "#F4D8CC",
    fontSize: 15,
    fontWeight: "700",
    marginTop: 8
  },
  heroActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 18,
    flexWrap: "wrap"
  },
  heroInsight: {
    color: "#F2C9BA",
    fontSize: 14,
    marginTop: 12
  },
  playButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#1ED760",
    alignItems: "center",
    justifyContent: "center"
  },
  playButtonText: {
    color: "#000000",
    fontSize: 24,
    fontWeight: "900",
    marginLeft: 3
  },
  pillButton: {
    backgroundColor: "rgba(0,0,0,0.26)",
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 11
  },
  pillButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900"
  },
  iconPill: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  iconPillText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800"
  },
  tabBar: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 24,
    paddingTop: 18,
    backgroundColor: "#121212"
  },
  tabButton: {
    borderRadius: 999,
    backgroundColor: "#232323",
    paddingHorizontal: 18,
    paddingVertical: 10
  },
  tabButtonActive: {
    backgroundColor: "#FFFFFF"
  },
  tabText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900"
  },
  tabTextActive: {
    color: "#000000"
  },
  tabContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 18,
    minHeight: 0
  },
  tabScroll: {
    padding: 24,
    gap: 14
  },
  searchControls: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 16
  },
  input: {
    backgroundColor: "#242424",
    borderRadius: 8,
    color: "#FFFFFF",
    minHeight: 48,
    paddingHorizontal: 14,
    fontSize: 15
  },
  searchInput: {
    backgroundColor: "#242424",
    borderRadius: 24,
    color: "#FFFFFF",
    flex: 1,
    minWidth: 220,
    minHeight: 48,
    paddingHorizontal: 18,
    fontSize: 15
  },
  nameInput: {
    backgroundColor: "#242424",
    borderRadius: 24,
    color: "#FFFFFF",
    width: 160,
    minHeight: 48,
    paddingHorizontal: 16,
    fontSize: 15
  },
  greenButton: {
    backgroundColor: "#1ED760",
    borderRadius: 999,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18
  },
  greenButtonSmall: {
    backgroundColor: "#1ED760",
    borderRadius: 999,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18
  },
  greenButtonText: {
    color: "#000000",
    fontSize: 14,
    fontWeight: "900"
  },
  secondaryDarkButton: {
    backgroundColor: "#2A2A2A",
    borderRadius: 999,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18
  },
  secondaryDarkButtonSmall: {
    backgroundColor: "#2A2A2A",
    borderRadius: 999,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16
  },
  secondaryDarkText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900"
  },
  dangerButtonSmall: {
    backgroundColor: "#3A1712",
    borderRadius: 999,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16
  },
  dangerButtonText: {
    color: "#FFB4A8",
    fontSize: 14,
    fontWeight: "900"
  },
  roundButton: {
    backgroundColor: "#242424",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  roundButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900"
  },
  notice: {
    color: "#1ED760",
    marginHorizontal: 24,
    marginTop: 12,
    fontSize: 14,
    fontWeight: "800"
  },
  error: {
    color: "#FFB4A8",
    backgroundColor: "#3A1712",
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    overflow: "hidden"
  },
  trackList: {
    paddingBottom: 24
  },
  trackScroller: {
    flex: 1,
    minHeight: 0
  },
  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#2A2A2A",
    paddingVertical: 10
  },
  tableHeadText: {
    color: "#A7A7A7",
    fontSize: 13,
    fontWeight: "800"
  },
  indexCol: {
    width: 34
  },
  titleCol: {
    flex: 1.4
  },
  albumCol: {
    flex: 0.8
  },
  actionCol: {
    width: 78,
    textAlign: "right"
  },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 68,
    borderRadius: 6,
    paddingHorizontal: 8
  },
  trackIndex: {
    color: "#B3B3B3",
    fontSize: 15,
    fontWeight: "700"
  },
  trackTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minWidth: 0
  },
  albumText: {
    color: "#A7A7A7",
    fontSize: 14
  },
  addButton: {
    backgroundColor: "#2A2A2A",
    borderRadius: 999,
    minHeight: 36,
    width: 78,
    alignItems: "center",
    justifyContent: "center"
  },
  addButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900"
  },
  disabled: {
    opacity: 0.55
  },
  recentBlock: {
    borderTopWidth: 1,
    borderTopColor: "#2A2A2A",
    paddingTop: 18,
    paddingBottom: 24
  },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8
  },
  statusAdded: {
    color: "#1ED760",
    fontSize: 12,
    fontWeight: "900"
  },
  statusQueued: {
    color: "#B3B3B3",
    fontSize: 12,
    fontWeight: "800"
  },
  failureReason: {
    color: "#FFB4A8",
    fontSize: 12,
    marginTop: 4
  },
  roomGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14
  },
  infoCard: {
    backgroundColor: "#181818",
    borderRadius: 8,
    padding: 18,
    minWidth: 260,
    flex: 1,
    gap: 10
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900"
  },
  roomCode: {
    color: "#FFFFFF",
    fontSize: 42,
    fontWeight: "900"
  },
  qrImage: {
    width: 160,
    height: 160,
    borderRadius: 8,
    backgroundColor: "#FFFFFF"
  },
  inlineButtons: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 8
  },
  statLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6
  },
  statLabel: {
    color: "#B3B3B3",
    fontSize: 14
  },
  statValue: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900"
  },
  shareHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12
  },
  playlistCard: {
    backgroundColor: "#181818",
    borderRadius: 8,
    overflow: "hidden"
  },
  playlistCardOpen: {
    backgroundColor: "#202020"
  },
  playlistCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12
  },
  playlistImage: {
    width: 72,
    height: 72,
    borderRadius: 6,
    backgroundColor: "#282828"
  },
  chevronText: {
    color: "#1ED760",
    fontSize: 13,
    fontWeight: "900"
  },
  sharedTrackList: {
    borderTopWidth: 1,
    borderTopColor: "#2A2A2A",
    paddingVertical: 8,
    paddingHorizontal: 12
  },
  sharedTrackRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8
  },
  sideQr: {
    width: 150,
    height: 150,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    alignSelf: "center"
  },
  sideCode: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "900",
    textAlign: "center"
  },
  sideCard: {
    backgroundColor: "#181818",
    borderRadius: 8,
    padding: 14,
    gap: 8
  },
  sideCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  insightText: {
    color: "#FFFFFF",
    fontSize: 14,
    lineHeight: 20
  },
  miniPlaylist: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  miniImage: {
    width: 42,
    height: 42,
    borderRadius: 5,
    backgroundColor: "#282828"
  },
  miniTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900"
  },
  albumArt: {
    borderRadius: 5,
    backgroundColor: "#282828"
  },
  albumFallback: {
    borderRadius: 6,
    backgroundColor: "#1ED760",
    alignItems: "center",
    justifyContent: "center"
  },
  albumFallbackText: {
    color: "#000000",
    fontWeight: "900"
  },
  sectionTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 8
  },
  itemTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800"
  },
  mutedText: {
    color: "#A7A7A7",
    fontSize: 13,
    marginTop: 3
  },
  softText: {
    color: "#777777",
    fontSize: 12,
    marginTop: 4
  },
  greenText: {
    color: "#1ED760",
    fontSize: 13,
    fontWeight: "900"
  },
  emptyText: {
    color: "#A7A7A7",
    paddingVertical: 28,
    textAlign: "center"
  },
  emptySideText: {
    color: "#777777",
    fontSize: 13,
    paddingVertical: 8
  },
  loadingArea: {
    padding: 28,
    alignItems: "center"
  },
  flex: {
    flex: 1,
    minWidth: 0
  }
});
