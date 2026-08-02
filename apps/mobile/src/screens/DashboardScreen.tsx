import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import { imgUrl } from "../lib/img";
import { formatMinutes, formatRelativeDate } from "../lib/format";
import type { SharedDetailParamList } from "../navigation/types";
import type {
  DashboardResponse,
  DailyPlayStat,
  LibraryGame,
} from "../lib/api";

type Nav = NativeStackNavigationProp<SharedDetailParamList>;

const COVER_W = 90;
const COVER_H = 120;

export default function DashboardScreen() {
  const { token } = useAuth();
  const nav = useNavigation<Nav>();

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyPlayStat[]>([]);
  const [playing, setPlaying] = useState<LibraryGame[]>([]);
  const [backlog, setBacklog] = useState<LibraryGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    await Promise.all([
      api.getDashboard(token).then(setDashboard).catch(() => {}),
      api.getDashboardDailyStats(token).then(setDailyStats).catch(() => {}),
      api.getDashboardPlaying(token).then(setPlaying).catch(() => {}),
      api.getDashboardBacklog(token).then(setBacklog).catch(() => {}),
    ]);
  }, [token]);

  useEffect(() => {
    if (!token) return;
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

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#6c47ff" />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <ScrollView
        style={s.root}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#6c47ff"
            colors={["#6c47ff"]}
          />
        }
      >
        {/* Header */}
        <View style={s.header}>
          <Text style={s.wordmark}>QUEST</Text>
        </View>

        {/* Now Playing */}
        {dashboard?.nowPlaying && (
          <Section title="Now Playing">
            <TouchableOpacity
              style={s.nowPlayingRow}
              onPress={() =>
                nav.navigate("GameDetail", { gameId: dashboard.nowPlaying!.gameId })
              }
            >
              {imgUrl(dashboard.nowPlaying.coverPath) ? (
                <Image
                  source={{ uri: imgUrl(dashboard.nowPlaying.coverPath)! }}
                  style={s.nowPlayingCover}
                  contentFit="cover"
                />
              ) : (
                <View style={[s.nowPlayingCover, s.coverFallback]} />
              )}
              <View style={s.nowPlayingInfo}>
                <Text style={s.nowPlayingTitle}>{dashboard.nowPlaying.title}</Text>
                <Text style={s.nowPlayingMeta}>
                  Since {formatRelativeDate(dashboard.nowPlaying.since)}
                </Text>
              </View>
              <View style={s.liveIndicator}>
                <Text style={s.liveText}>LIVE</Text>
              </View>
            </TouchableOpacity>
          </Section>
        )}

        {/* Currently Playing */}
        {playing.length > 0 && (
          <Section title="Currently Playing">
            <FlatList
              horizontal
              data={playing}
              keyExtractor={(g) => String(g.id)}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              renderItem={({ item }) => (
                <GameCoverCard
                  game={item}
                  onPress={() => nav.navigate("GameDetail", { gameId: item.id })}
                />
              )}
            />
          </Section>
        )}

        {/* Backlog */}
        {backlog.length > 0 && (
          <Section title="Up Next (Backlog)">
            <FlatList
              horizontal
              data={backlog.slice(0, 10)}
              keyExtractor={(g) => String(g.id)}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              renderItem={({ item }) => (
                <GameCoverCard
                  game={item}
                  onPress={() => nav.navigate("GameDetail", { gameId: item.id })}
                />
              )}
            />
          </Section>
        )}

        {/* Activity chart */}
        <ActivityGraph stats={dailyStats} />

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <View style={s.sectionAccent} />
        <Text style={s.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function GameCoverCard({
  game,
  onPress,
}: {
  game: LibraryGame;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress}>
      <View style={s.coverCard}>
        {imgUrl(game.coverPath) ? (
          <Image
            source={{ uri: imgUrl(game.coverPath)! }}
            style={s.coverImg}
            contentFit="cover"
          />
        ) : (
          <View style={[s.coverImg, s.coverFallback]}>
            <Text style={s.coverFallbackText} numberOfLines={2}>
              {game.title}
            </Text>
          </View>
        )}
        <Text style={s.coverLabel} numberOfLines={2}>
          {game.title}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function ActivityGraph({ stats }: { stats: DailyPlayStat[] }) {
  const statsByDate = new Map(stats.map((d) => [d.date, d.totalMin]));
  const last14: DailyPlayStat[] = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    const date = d.toISOString().slice(0, 10);
    return { date, totalMin: statsByDate.get(date) ?? 0 };
  });
  const maxMin = Math.max(...last14.map((d) => d.totalMin), 1);
  const BAR_H = 50;
  const totalMin = last14.reduce((sum, d) => sum + d.totalMin, 0);

  return (
    <Section title="Last 14 Days">
      <View style={s.graphBox}>
        <Text style={s.graphSummary}>{formatMinutes(totalMin)} played</Text>
        <View style={s.graphBars}>
          {last14.map((day, i) => (
            <View key={i} style={s.barCol}>
              <View style={[s.barTrack, { height: BAR_H }]}>
                <View
                  style={[
                    s.barFill,
                    {
                      height:
                        day.totalMin > 0
                          ? Math.max((day.totalMin / maxMin) * BAR_H, 3)
                          : 0,
                    },
                  ]}
                />
              </View>
              <Text style={s.barLabel}>{day.date.slice(8, 10)}</Text>
            </View>
          ))}
        </View>
      </View>
    </Section>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1b2838" },
  content: { flexGrow: 1 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1b2838",
  },

  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  wordmark: {
    fontSize: 22,
    fontWeight: "900",
    color: "#f0f0f6",
    letterSpacing: 4,
  },

  nowPlayingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    backgroundColor: "#162330",
    borderRadius: 10,
    padding: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(108,71,255,0.3)",
  },
  nowPlayingCover: { width: 48, height: 64, borderRadius: 6 },
  nowPlayingInfo: { flex: 1 },
  nowPlayingTitle: { color: "#f0f0f6", fontWeight: "700", fontSize: 14 },
  nowPlayingMeta: { color: "#888", fontSize: 12, marginTop: 2 },
  liveIndicator: {
    backgroundColor: "#6c47ff",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveText: { color: "#fff", fontWeight: "800", fontSize: 10, letterSpacing: 1 },

  section: { paddingTop: 24 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionAccent: { width: 3, height: 20, borderRadius: 2, backgroundColor: "#6c47ff" },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#f0f0f6", letterSpacing: -0.3 },

  coverCard: { width: COVER_W },
  coverImg: { width: COVER_W, height: COVER_H, borderRadius: 6 },
  coverFallback: { backgroundColor: "#313e52", justifyContent: "center", alignItems: "center", padding: 6 },
  coverFallbackText: { fontSize: 10, color: "#888", textAlign: "center" },
  coverLabel: { fontSize: 11, color: "#d7d8e2", marginTop: 5, lineHeight: 14 },

  graphBox: {
    marginHorizontal: 16,
    backgroundColor: "#162330",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  graphSummary: {
    fontSize: 12,
    color: "rgba(240,240,246,0.45)",
    marginBottom: 12,
  },
  graphBars: { flexDirection: "row", alignItems: "flex-end", gap: 3 },
  barCol: { flex: 1, alignItems: "center" },
  barTrack: { width: "100%", justifyContent: "flex-end" },
  barFill: {
    width: "100%",
    backgroundColor: "rgba(108,71,255,0.7)",
    borderRadius: 2,
  },
  barLabel: { fontSize: 9, color: "rgba(240,240,246,0.3)", marginTop: 4 },
});
