import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  ScrollView,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../contexts/AuthContext";
import { api, PLATFORM_LABELS } from "../lib/api";
import type { LibraryGame, GameStatus } from "../lib/api";
import { imgUrl } from "../lib/img";
import type { SharedDetailParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<SharedDetailParamList>;

const COVER_W = 100;
const COVER_H = 133;
const NUM_COLS = 3;

const STATUS_OPTIONS: { label: string; value: GameStatus | "" }[] = [
  { label: "All", value: "" },
  { label: "Unplayed", value: "unplayed" },
  { label: "Playing", value: "playing" },
  { label: "Completed", value: "completed" },
  { label: "Other", value: "other" },
];

const PLATFORM_OPTIONS = [
  { label: "All", value: "" },
  { label: "Steam", value: "steam" },
  { label: "PSN", value: "psn" },
  { label: "Xbox", value: "xbox" },
  { label: "Epic", value: "epic" },
  { label: "GOG", value: "gog" },
  { label: "Meta Quest", value: "meta_quest" },
];

export default function LibraryScreen() {
  const { token } = useAuth();
  const nav = useNavigation<Nav>();

  const [games, setGames] = useState<LibraryGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<GameStatus | "">("");
  const [platform, setPlatform] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    const params: Record<string, string | boolean> = {};
    if (status) params.status = status;
    if (platform) params.platform = platform;
    if (search) params.q = search;
    const data = await api.getLibrary(token, params);
    setGames(data);
  }, [token, status, platform, search]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [token, load]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  const filtered = games; // filtering is server-side; local search already sent

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Text style={s.title}>Library</Text>
        <Text style={s.count}>{games.length} games</Text>
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          placeholder="Search games…"
          placeholderTextColor="#666"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          onSubmitEditing={load}
        />
      </View>

      {/* Status + Platform filters */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.filterScroll}
        contentContainerStyle={s.filterRow}
      >
        {STATUS_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={`s-${opt.value}`}
            style={[s.filterChip, status === opt.value && s.filterChipActive]}
            onPress={() => setStatus(opt.value)}
          >
            <Text style={[s.filterChipText, status === opt.value && s.filterChipTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={s.filterDivider} />
        {PLATFORM_OPTIONS.filter((o) => o.value !== "").map((opt) => (
          <TouchableOpacity
            key={`p-${opt.value}`}
            style={[s.filterChip, platform === opt.value && s.filterChipActive]}
            onPress={() => setPlatform(platform === opt.value ? "" : opt.value)}
          >
            <Text style={[s.filterChipText, platform === opt.value && s.filterChipTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color="#6c47ff" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(g) => String(g.id)}
          numColumns={NUM_COLS}
          contentContainerStyle={s.grid}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#6c47ff"
              colors={["#6c47ff"]}
            />
          }
          ListEmptyComponent={
            <Text style={s.empty}>No games found.</Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.coverCell}
              onPress={() => nav.navigate("GameDetail", { gameId: item.id })}
            >
              {imgUrl(item.coverPath) ? (
                <Image
                  source={{ uri: imgUrl(item.coverPath)! }}
                  style={s.coverImg}
                  contentFit="cover"
                />
              ) : (
                <View style={[s.coverImg, s.coverFallback]}>
                  <Text style={s.coverFallbackText} numberOfLines={3}>
                    {item.title}
                  </Text>
                </View>
              )}
              {item.status && (
                <View style={[s.statusBadge, statusColor(item.status)]}>
                  <Text style={s.statusBadgeText}>
                    {item.status.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={s.coverLabel} numberOfLines={2}>
                {item.title}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function statusColor(status: GameStatus) {
  switch (status) {
    case "playing":
      return { backgroundColor: "#6c47ff" };
    case "completed":
      return { backgroundColor: "#4caf50" };
    case "other":
      return { backgroundColor: "#888" };
    default:
      return { backgroundColor: "#444" };
  }
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1b2838" },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 8,
  },
  title: { fontSize: 22, fontWeight: "900", color: "#f0f0f6" },
  count: { fontSize: 13, color: "#888" },

  searchRow: { paddingHorizontal: 16, marginBottom: 8 },
  searchInput: {
    backgroundColor: "#162330",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#f0f0f6",
    fontSize: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  filterScroll: { height: 56, marginBottom: 8, flexGrow: 0, flexShrink: 0 },
  filterRow: { paddingHorizontal: 16, gap: 8, alignItems: "center", height: 56 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#162330",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  filterChipActive: {
    backgroundColor: "#6c47ff",
    borderColor: "#6c47ff",
  },
  filterChipText: { fontSize: 13, color: "#888" },
  filterChipTextActive: { color: "#fff", fontWeight: "700" },
  filterDivider: {
    width: 1,
    height: 20,
    marginHorizontal: 4,
    backgroundColor: "rgba(255,255,255,0.12)",
  },

  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  empty: {
    color: "#888",
    textAlign: "center",
    marginTop: 40,
    fontSize: 14,
  },

  grid: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 32 },
  coverCell: { flex: 1, margin: 4, maxWidth: "33.33%" },
  coverImg: { width: "100%", aspectRatio: 3 / 4, borderRadius: 6 },
  coverFallback: {
    backgroundColor: "#313e52",
    justifyContent: "center",
    alignItems: "center",
    padding: 6,
  },
  coverFallbackText: { fontSize: 10, color: "#888", textAlign: "center" },
  coverLabel: { fontSize: 11, color: "#d7d8e2", marginTop: 4, lineHeight: 14 },
  statusBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  statusBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
});
