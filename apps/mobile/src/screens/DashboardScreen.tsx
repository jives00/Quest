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
  Dimensions,
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
  DashboardSummary,
  DashboardHero,
  DailyPlayStat,
  LibraryGame,
  UpcomingGame,
} from "../lib/api";

type Nav = NativeStackNavigationProp<SharedDetailParamList>;

const { width: SCREEN_W } = Dimensions.get("window");
const COVER_W = 90;
const COVER_H = 120;

export default function DashboardScreen() {
  const { token } = useAuth();
  const nav = useNavigation<Nav>();

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [hero, setHero] = useState<DashboardHero | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyPlayStat[]>([]);
  const [playing, setPlaying] = useState<LibraryGame[]>([]);
  const [backlog, setBacklog] = useState<LibraryGame[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    await Promise.all([
      api.getDashboard(token).then(setDashboard).catch(() => {}),
      api.getDashboardSummary(token).then(setSummary).catch(() => {}),
      api.getDashboardHero(token).then((h) => setHero(h ?? null)).catch(() => {}),
      api.getDashboardDailyStats(token).then(setDailyStats).catch(() => {}),
      api.getDashboardPlaying(token).then(setPlaying).catch(() => {}),
      api.getDashboardBacklog(token).then(setBacklog).catch(() => {}),
      api.getDashboardUpcoming(token).then(setUpcoming).catch(() => {}),
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

        {/* Hero */}
        {hero && (
          <TouchableOpacity onPress={() => nav.navigate("GameDetail", { gameId: hero.id })}>
            <View style={s.heroCard}>
              {imgUrl(hero.heroPath) && (
                <Image
                  source={{ uri: imgUrl(hero.heroPath)! }}
                  style={s.heroImg}
                  contentFit="cover"
                />
              )}
              <View style={s.heroOverlay}>
                <Text style={s.heroTitle}>{hero.title}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}

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

        {/* Summary stats */}
        {summary && (
          <Section title="Your Library">
            <View style={s.statsRow}>
              <StatCard label="Games" value={String(summary.totalGames)} />
              <StatCard label="Finished" value={String(summary.finishedCount)} />
              <StatCard label="Perfect" value={String(summary.perfectCount)} />
              <StatCard label="Time" value={formatMinutes(summary.lifetimeMin)} />
            </View>
          </Section>
        )}

        {/* Activity chart */}
        {dailyStats.length > 0 && <ActivityGraph stats={dailyStats} />}

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

        {/* Upcoming releases */}
        {upcoming.length > 0 && (
          <Section title="Upcoming Releases">
            {upcoming.slice(0, 5).map((g) => (
              <View key={g.id} style={s.upcomingRow}>
                {imgUrl(g.coverPath) ? (
                  <Image
                    source={{ uri: imgUrl(g.coverPath)! }}
                    style={s.upcomingCover}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[s.upcomingCover, s.coverFallback]} />
                )}
                <View style={s.upcomingInfo}>
                  <Text style={s.upcomingTitle} numberOfLines={1}>
                    {g.title}
                  </Text>
                  <Text style={s.upcomingDate}>{g.releaseDate}</Text>
                </View>
              </View>
            ))}
          </Section>
        )}

        {/* Recent sessions */}
        {(dashboard?.recentSessions?.length ?? 0) > 0 && (
          <Section title="Recent Sessions">
            {dashboard!.recentSessions.slice(0, 5).map((s2) => (
              <TouchableOpacity
                key={s2.id}
                style={s.sessionRow}
                onPress={() => nav.navigate("GameDetail", { gameId: s2.gameId })}
              >
                {imgUrl(s2.coverPath) ? (
                  <Image
                    source={{ uri: imgUrl(s2.coverPath)! }}
                    style={s.sessionCover}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[s.sessionCover, s.coverFallback]} />
                )}
                <View style={s.sessionInfo}>
                  <Text style={s.sessionTitle} numberOfLines={1}>
                    {s2.title}
                  </Text>
                  <Text style={s.sessionMeta}>
                    {formatMinutes(s2.durationMin)} ·{" "}
                    {formatRelativeDate(s2.endedAt)}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </Section>
        )}

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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.statCard}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
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
  const last14 = stats.slice(-14);
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
  root: { flex: 1, backgroundColor: "#1c1e26" },
  content: { flexGrow: 1 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1c1e26",
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

  heroCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    overflow: "hidden",
    height: 180,
  },
  heroImg: { width: "100%", height: "100%" },
  heroOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  heroTitle: { color: "#f0f0f6", fontWeight: "800", fontSize: 16 },

  nowPlayingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    backgroundColor: "#1e2029",
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

  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#1e2029",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  statValue: { color: "#f0f0f6", fontWeight: "800", fontSize: 16 },
  statLabel: { color: "#888", fontSize: 10, marginTop: 2 },

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
  coverFallback: { backgroundColor: "#323440", justifyContent: "center", alignItems: "center", padding: 6 },
  coverFallbackText: { fontSize: 10, color: "#888", textAlign: "center" },
  coverLabel: { fontSize: 11, color: "#d7d8e2", marginTop: 5, lineHeight: 14 },

  upcomingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  upcomingCover: { width: 36, height: 48, borderRadius: 4 },
  upcomingInfo: { flex: 1 },
  upcomingTitle: { color: "#f0f0f6", fontSize: 13, fontWeight: "600" },
  upcomingDate: { color: "#888", fontSize: 11, marginTop: 2 },

  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  sessionCover: { width: 36, height: 48, borderRadius: 4 },
  sessionInfo: { flex: 1 },
  sessionTitle: { color: "#f0f0f6", fontSize: 13, fontWeight: "600" },
  sessionMeta: { color: "#888", fontSize: 11, marginTop: 2 },

  graphBox: {
    marginHorizontal: 16,
    backgroundColor: "#1e2029",
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
