import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  FlatList,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import type { Stats } from "../lib/api";
import { imgUrl } from "../lib/img";
import { formatMinutes, formatHours } from "../lib/format";
import type { SharedDetailParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<SharedDetailParamList>;

export default function StatsScreen() {
  const { token } = useAuth();
  const nav = useNavigation<Nav>();

  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const data = await api.getStats(token);
    setStats(data);
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

  if (!stats) {
    return (
      <View style={s.center}>
        <Text style={s.emptyText}>No stats available.</Text>
      </View>
    );
  }

  const ov = stats.overview;

  return (
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
      {/* Overview — 2×2 matching web layout */}
      <View style={s.overviewGrid}>
        <StatCard
          label="Lifetime"
          value={formatHours(ov.lifetimeMinutes)}
          hint={`${formatHours(ov.trackedMinutes)} tracked`}
        />
        <StatCard
          label="Achievements"
          value={ov.achievementsUnlocked.toLocaleString()}
          hint={`${ov.perfectGames} perfect`}
        />
        <StatCard
          label="Backlog"
          value={((stats.statusCounts["unplayed"] ?? 0) + (stats.statusCounts["playing"] ?? 0)).toLocaleString()}
          hint="unplayed + playing"
        />
        <StatCard
          label="Completed"
          value={(stats.statusCounts["completed"] ?? 0).toLocaleString()}
        />
      </View>

      {/* Top played */}
      {stats.topPlayed.length > 0 && (
        <>
          <SectionHeader title="Top Played" />
          {stats.topPlayed.slice(0, 10).map((g, i) => (
            <TouchableOpacity
              key={g.gameId}
              style={s.topRow}
              onPress={() => nav.navigate("GameDetail", { gameId: g.gameId })}
            >
              <Text style={s.topRank}>#{i + 1}</Text>
              {imgUrl(g.coverPath) ? (
                <Image
                  source={{ uri: imgUrl(g.coverPath)! }}
                  style={s.topCover}
                  contentFit="cover"
                />
              ) : (
                <View style={[s.topCover, s.coverFallback]} />
              )}
              <View style={s.topInfo}>
                <Text style={s.topTitle} numberOfLines={1}>
                  {g.title}
                </Text>
                <Text style={s.topTime}>{formatMinutes(g.playMinutes)}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}

      {/* By platform */}
      {stats.byPlatform.length > 0 && (
        <>
          <SectionHeader title="By Platform" />
          {stats.byPlatform.map((p) => (
            <View key={p.platform} style={s.platformRow}>
              <Text style={s.platformLabel}>{p.label}</Text>
              <View style={s.platformStats}>
                <Text style={s.platformStat}>{p.owned} owned</Text>
                <Text style={s.platformStat}>{formatMinutes(p.playMinutes)}</Text>
                {p.achievements > 0 && (
                  <Text style={s.platformStat}>{p.achievements} ach.</Text>
                )}
              </View>
            </View>
          ))}
        </>
      )}

      {/* By genre */}
      {stats.byGenre.length > 0 && (
        <>
          <SectionHeader title="By Genre" />
          {stats.byGenre.slice(0, 10).map((g) => (
            <View key={g.genre} style={s.genreRow}>
              <Text style={s.genreLabel}>{g.genre}</Text>
              <Text style={s.genreStats}>
                {g.games} games · {formatMinutes(g.playMinutes)}
              </Text>
            </View>
          ))}
        </>
      )}

      {/* Completions by year */}
      {stats.completionsByYear.length > 0 && (
        <>
          <SectionHeader title="Completions by Year" />
          {stats.completionsByYear.map((cy) => (
            <View key={cy.year} style={s.yearRow}>
              <Text style={s.yearLabel}>{cy.year}</Text>
              <Text style={s.yearCount}>{cy.count} games</Text>
            </View>
          ))}
        </>
      )}

      {/* Perfect games */}
      {stats.perfectGames.length > 0 && (
        <>
          <SectionHeader title="Perfect Games" />
          {stats.perfectGames.slice(0, 5).map((g) => (
            <TouchableOpacity
              key={g.gameId}
              style={s.topRow}
              onPress={() => nav.navigate("GameDetail", { gameId: g.gameId })}
            >
              {imgUrl(g.coverPath) ? (
                <Image
                  source={{ uri: imgUrl(g.coverPath)! }}
                  style={s.topCover}
                  contentFit="cover"
                />
              ) : (
                <View style={[s.topCover, s.coverFallback]} />
              )}
              <View style={s.topInfo}>
                <Text style={s.topTitle} numberOfLines={1}>
                  {g.title}
                </Text>
                <Text style={s.topTime}>{g.achievementCount} achievements</Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}

      {/* Rarity */}
      {stats.rarityAchievements.length > 0 && (
        <>
          <SectionHeader title="Rarest Achievements" />
          {stats.rarityAchievements.slice(0, 5).map((a) => (
            <View key={`${a.gameId}-${a.apiName}`} style={s.rarityRow}>
              <Text style={s.rarityName} numberOfLines={1}>
                {a.name}
              </Text>
              <Text style={s.rarityGame} numberOfLines={1}>
                {a.title} · {a.globalPct.toFixed(1)}% globally
              </Text>
            </View>
          ))}
        </>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={s.sectionHeader}>
      <View style={s.sectionAccent} />
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={s.statCard}>
      <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
      <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value}</Text>
      {hint ? <Text style={s.statHint} numberOfLines={1}>{hint}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1c1e26" },
  content: { paddingBottom: 32 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1c1e26",
  },
  emptyText: { color: "#888", fontSize: 14 },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    marginTop: 24,
    marginBottom: 12,
  },
  sectionAccent: { width: 3, height: 18, borderRadius: 2, backgroundColor: "#6c47ff" },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: "#f0f0f6" },

  overviewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 16,
    gap: 10,
  },
  statCard: {
    width: "47%",
    backgroundColor: "#1e2029",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  statLabel: { color: "#888", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  statValue: { color: "#f0f0f6", fontWeight: "900", fontSize: 26, marginTop: 4 },
  statHint: { color: "#555", fontSize: 11, marginTop: 3 },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  topRank: { color: "#666", fontSize: 12, width: 22, textAlign: "right" },
  topCover: { width: 36, height: 48, borderRadius: 4 },
  coverFallback: { backgroundColor: "#323440" },
  topInfo: { flex: 1 },
  topTitle: { color: "#f0f0f6", fontSize: 13, fontWeight: "600" },
  topTime: { color: "#888", fontSize: 12, marginTop: 1 },

  platformRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  platformLabel: { color: "#f0f0f6", fontSize: 13, fontWeight: "600" },
  platformStats: { flexDirection: "row", gap: 12, marginTop: 3 },
  platformStat: { color: "#888", fontSize: 11 },

  genreRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  genreLabel: { color: "#f0f0f6", fontSize: 13 },
  genreStats: { color: "#888", fontSize: 12 },

  yearRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  yearLabel: { color: "#f0f0f6", fontSize: 13, fontWeight: "700" },
  yearCount: { color: "#888", fontSize: 13 },

  rarityRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  rarityName: { color: "#f0f0f6", fontSize: 13, fontWeight: "600" },
  rarityGame: { color: "#888", fontSize: 11, marginTop: 2 },
});
