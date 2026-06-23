import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

const DEFAULT_API_URL = Platform.OS === "web" ? "http://localhost:8000" : "http://10.0.2.2:8000";
const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL).replace(/\/$/, "");

const statusLabels = {
  pending: "대기",
  approved: "승인",
  rejected: "삭제"
};

export default function App() {
  const [mode, setMode] = useState("guest");
  const [venue, setVenue] = useState(null);
  const [query, setQuery] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [tracks, setTracks] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submittingId, setSubmittingId] = useState("");
  const [error, setError] = useState("");

  const pendingRequests = useMemo(
    () => requests.filter((item) => item.status === "pending"),
    [requests]
  );

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

  async function loadVenue() {
    const data = await api("/api/venue");
    setVenue(data);
  }

  async function loadRequests() {
    const data = await api("/api/requests");
    setRequests(data);
  }

  async function searchTracks(nextQuery = query) {
    setLoading(true);
    setError("");
    try {
      const data = await api(`/api/tracks/search?q=${encodeURIComponent(nextQuery)}`);
      setTracks(data);
    } catch (err) {
      setError("서버에 연결하지 못했습니다. API 주소를 확인하세요.");
    } finally {
      setLoading(false);
    }
  }

  async function addRequest(track) {
    setSubmittingId(track.id);
    setError("");
    try {
      await api("/api/requests", {
        method: "POST",
        body: JSON.stringify({
          track,
          requester_name: requesterName || "익명"
        })
      });
      await Promise.all([loadVenue(), loadRequests()]);
      Alert.alert("신청 완료", "운영자 화면에서 승인할 수 있습니다.");
    } catch (err) {
      setError("신청을 저장하지 못했습니다.");
    } finally {
      setSubmittingId("");
    }
  }

  async function updateRequest(id, action) {
    setSubmittingId(id);
    setError("");
    try {
      if (action === "approve") {
        await api(`/api/admin/requests/${id}/approve`, { method: "POST" });
      } else {
        await api(`/api/admin/requests/${id}`, { method: "DELETE" });
      }
      await Promise.all([loadVenue(), loadRequests()]);
    } catch (err) {
      setError("관리자 작업을 처리하지 못했습니다.");
    } finally {
      setSubmittingId("");
    }
  }

  useEffect(() => {
    Promise.all([loadVenue(), loadRequests(), searchTracks("")]).catch(() => {
      setError("서버에 연결하지 못했습니다. 백엔드가 켜져 있는지 확인하세요.");
    });
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>QR Playlist</Text>
            <Text style={styles.title}>{venue?.name || "Playlist Request"}</Text>
          </View>
          <View style={styles.queuePill}>
            <Text style={styles.queueNumber}>{venue?.queue_size ?? pendingRequests.length}</Text>
            <Text style={styles.queueLabel}>대기</Text>
          </View>
        </View>

        <View style={styles.nowPlaying}>
          <AlbumArt track={venue?.now_playing} />
          <View style={styles.nowPlayingText}>
            <Text style={styles.label}>Now Playing</Text>
            <Text style={styles.trackName} numberOfLines={1}>
              {venue?.now_playing?.name || "Loading"}
            </Text>
            <Text style={styles.artistName} numberOfLines={1}>
              {venue?.now_playing?.artists?.join(", ") || "잠시만요"}
            </Text>
          </View>
        </View>

        <View style={styles.segmented}>
          <SegmentButton active={mode === "guest"} label="신청" onPress={() => setMode("guest")} />
          <SegmentButton active={mode === "admin"} label="관리" onPress={() => setMode("admin")} />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {mode === "guest" ? (
          <GuestView
            query={query}
            setQuery={setQuery}
            requesterName={requesterName}
            setRequesterName={setRequesterName}
            loading={loading}
            tracks={tracks}
            submittingId={submittingId}
            searchTracks={searchTracks}
            addRequest={addRequest}
          />
        ) : (
          <AdminView
            requests={requests}
            pendingRequests={pendingRequests}
            submittingId={submittingId}
            updateRequest={updateRequest}
            loadRequests={loadRequests}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function GuestView({
  query,
  setQuery,
  requesterName,
  setRequesterName,
  loading,
  tracks,
  submittingId,
  searchTracks,
  addRequest
}) {
  return (
    <View style={styles.content}>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => searchTracks(query)}
          placeholder="곡명 또는 아티스트"
          placeholderTextColor="#7D8477"
          style={styles.searchInput}
          returnKeyType="search"
        />
        <Pressable style={styles.primaryButton} onPress={() => searchTracks(query)}>
          <Text style={styles.primaryButtonText}>검색</Text>
        </Pressable>
      </View>

      <TextInput
        value={requesterName}
        onChangeText={setRequesterName}
        placeholder="신청자 이름 선택 입력"
        placeholderTextColor="#7D8477"
        style={styles.nameInput}
        maxLength={30}
      />

      {loading ? (
        <View style={styles.loadingArea}>
          <ActivityIndicator color="#1F6F64" />
        </View>
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TrackRow
              track={item}
              actionLabel={submittingId === item.id ? "저장중" : "신청"}
              disabled={Boolean(submittingId)}
              onPress={() => addRequest(item)}
            />
          )}
          ListEmptyComponent={<Text style={styles.empty}>검색 결과가 없습니다.</Text>}
        />
      )}
    </View>
  );
}

function AdminView({ requests, pendingRequests, submittingId, updateRequest, loadRequests }) {
  return (
    <ScrollView style={styles.content} contentContainerStyle={styles.list}>
      <View style={styles.adminHeader}>
        <View>
          <Text style={styles.sectionTitle}>신청곡 큐</Text>
          <Text style={styles.helperText}>대기 {pendingRequests.length}곡</Text>
        </View>
        <Pressable style={styles.secondaryButton} onPress={loadRequests}>
          <Text style={styles.secondaryButtonText}>새로고침</Text>
        </Pressable>
      </View>

      {requests.length === 0 ? (
        <Text style={styles.empty}>아직 신청곡이 없습니다.</Text>
      ) : (
        requests.map((request) => (
          <View key={request.id} style={styles.requestRow}>
            <View style={styles.requestMain}>
              <Text style={styles.trackName} numberOfLines={1}>
                {request.track.name}
              </Text>
              <Text style={styles.artistName} numberOfLines={1}>
                {request.track.artists.join(", ")} · {request.requester_name}
              </Text>
              <Text style={styles.statusText}>{statusLabels[request.status]}</Text>
            </View>

            {request.status === "pending" ? (
              <View style={styles.adminActions}>
                <Pressable
                  style={[styles.smallButton, styles.approveButton]}
                  disabled={Boolean(submittingId)}
                  onPress={() => updateRequest(request.id, "approve")}
                >
                  <Text style={styles.smallButtonText}>
                    {submittingId === request.id ? "처리" : "승인"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.smallButton, styles.rejectButton]}
                  disabled={Boolean(submittingId)}
                  onPress={() => updateRequest(request.id, "reject")}
                >
                  <Text style={styles.rejectButtonText}>삭제</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

function SegmentButton({ active, label, onPress }) {
  return (
    <Pressable style={[styles.segmentButton, active && styles.segmentButtonActive]} onPress={onPress}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

function TrackRow({ track, actionLabel, disabled, onPress }) {
  return (
    <View style={styles.trackRow}>
      <AlbumArt track={track} />
      <View style={styles.trackInfo}>
        <Text style={styles.trackName} numberOfLines={1}>
          {track.name}
        </Text>
        <Text style={styles.artistName} numberOfLines={1}>
          {track.artists.join(", ")}
        </Text>
        <Text style={styles.albumName} numberOfLines={1}>
          {track.album || "Single"}
        </Text>
      </View>
      <Pressable
        style={[styles.secondaryButton, disabled && styles.buttonDisabled]}
        disabled={disabled}
        onPress={onPress}
      >
        <Text style={styles.secondaryButtonText}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

function AlbumArt({ track }) {
  if (track?.image_url) {
    return <Image source={{ uri: track.image_url }} style={styles.albumArt} />;
  }

  return (
    <View style={styles.albumFallback}>
      <Text style={styles.albumFallbackText}>{track?.name?.slice(0, 1) || "P"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F7F5EF"
  },
  screen: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 12
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14
  },
  eyebrow: {
    color: "#607064",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  title: {
    color: "#17211D",
    fontSize: 28,
    fontWeight: "800"
  },
  queuePill: {
    alignItems: "center",
    backgroundColor: "#DDE8E2",
    borderRadius: 8,
    minWidth: 58,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  queueNumber: {
    color: "#123D36",
    fontSize: 18,
    fontWeight: "800"
  },
  queueLabel: {
    color: "#496257",
    fontSize: 11,
    fontWeight: "700"
  },
  nowPlaying: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E7E1D5",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12
  },
  nowPlayingText: {
    flex: 1
  },
  label: {
    color: "#7D8477",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 3
  },
  trackName: {
    color: "#18231E",
    fontSize: 16,
    fontWeight: "800"
  },
  artistName: {
    color: "#56635B",
    fontSize: 13,
    marginTop: 3
  },
  albumName: {
    color: "#8B8171",
    fontSize: 12,
    marginTop: 3
  },
  segmented: {
    backgroundColor: "#E8E4DA",
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    marginVertical: 14,
    padding: 4
  },
  segmentButton: {
    alignItems: "center",
    borderRadius: 6,
    flex: 1,
    paddingVertical: 10
  },
  segmentButtonActive: {
    backgroundColor: "#FFFFFF"
  },
  segmentText: {
    color: "#687066",
    fontSize: 14,
    fontWeight: "800"
  },
  segmentTextActive: {
    color: "#173F39"
  },
  error: {
    backgroundColor: "#F8DFD9",
    borderRadius: 8,
    color: "#8A281A",
    fontSize: 13,
    marginBottom: 10,
    padding: 10
  },
  content: {
    flex: 1
  },
  searchRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8
  },
  searchInput: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E1DCCD",
    borderRadius: 8,
    borderWidth: 1,
    color: "#17211D",
    flex: 1,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 12
  },
  nameInput: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E1DCCD",
    borderRadius: 8,
    borderWidth: 1,
    color: "#17211D",
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 12
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#1F6F64",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 18
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800"
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#DDE8E2",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 14
  },
  secondaryButtonText: {
    color: "#17443D",
    fontSize: 13,
    fontWeight: "800"
  },
  buttonDisabled: {
    opacity: 0.55
  },
  list: {
    gap: 10,
    paddingBottom: 28,
    paddingTop: 12
  },
  trackRow: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E7E1D5",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 10
  },
  trackInfo: {
    flex: 1,
    minWidth: 0
  },
  albumArt: {
    backgroundColor: "#D9DED8",
    borderRadius: 8,
    height: 54,
    width: 54
  },
  albumFallback: {
    alignItems: "center",
    backgroundColor: "#D9DED8",
    borderRadius: 8,
    height: 54,
    justifyContent: "center",
    width: 54
  },
  albumFallbackText: {
    color: "#1F463F",
    fontSize: 20,
    fontWeight: "900"
  },
  loadingArea: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  },
  empty: {
    color: "#667068",
    fontSize: 14,
    padding: 18,
    textAlign: "center"
  },
  adminHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  sectionTitle: {
    color: "#17211D",
    fontSize: 20,
    fontWeight: "800"
  },
  helperText: {
    color: "#6C746D",
    fontSize: 13,
    marginTop: 3
  },
  requestRow: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E7E1D5",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12
  },
  requestMain: {
    flex: 1,
    minWidth: 0
  },
  statusText: {
    color: "#1F6F64",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 6
  },
  adminActions: {
    flexDirection: "row",
    gap: 6
  },
  smallButton: {
    alignItems: "center",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 10
  },
  approveButton: {
    backgroundColor: "#1F6F64"
  },
  rejectButton: {
    backgroundColor: "#F0D8D2"
  },
  smallButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800"
  },
  rejectButtonText: {
    color: "#8A281A",
    fontSize: 12,
    fontWeight: "800"
  }
});
