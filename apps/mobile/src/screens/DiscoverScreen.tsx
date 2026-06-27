import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import type { DiscoverCategory, DiscoverGame, DiscoverResponse, GenreOption } from "../lib/api";
import type { SharedDetailParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<SharedDetailParamList>;

const CATEGORIES: { label: string; value: DiscoverCategory }[] = [
  { label: "Trending", value: "trending" },
  { label: "New", value: "new_releases" },
  { label: "Anticipated", value: "anticipated" },
  { label: "Top Rated", value: "top_rated" },
  { label: "Steam Top", value: "steam_top_sellers" },
  { label: "By Genre", value: "by_genre" },
];

const COVER_W = 100;
const COVER_H = 133;

export default function DiscoverScreen() {
  const { token } = useAuth();
  const nav = useNavigation<Nav>();

  const [category, setCategory] = useState<DiscoverCategory>("trending");
  const [genres, setGenres] = useState<GenreOption[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<number | undefined>();
  const [games, setGames] = useState<DiscoverGame[]>([]);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.getDiscoverGenres(token).then(setGenres).catch(() => {});
  }, [token]);

  const load = useCallback(
    async (p = 1, reset = true) => {
      if (!token) return;
      if (p === 1 && reset) setLoading(true);
      else setLoadingMore(true);
      try {
        const params: { page?: number; genreId?: number } = { page: p };
        if (category === "by_genre" && selectedGenre) params.genreId = selectedGenre;
        const res = await api.discover(category, token, params);
        if (reset || p === 1) {
          setGames(res.items);
        } else {
          setGames((prev) => [...prev, ...res.items]);
        }
        setHasNextPage(res.hasNextPage);
        setPage(p);
      } catch {
        // ignore
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [token, category, selectedGenre]
  );

  useEffect(() => {
    load(1, true);
  }, [category, selectedGenre, load]);

  function handleEndReached() {
    if (hasNextPage && !loadingMore) {
      load(page + 1, false);
    }
  }

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Text style={s.title}>Discover</Text>
      </View>

      {/* Category tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.tabRow}
      >
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat.value}
            style={[s.tab, category === cat.value && s.tabActive]}
            onPress={() => {
              setCategory(cat.value);
              setSelectedGenre(undefined);
            }}
          >
            <Text style={[s.tabText, category === cat.value && s.tabTextActive]}>
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Genre picker (only for by_genre) */}
      {category === "by_genre" && genres.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tabRow}
        >
          {genres.map((g) => (
            <TouchableOpacity
              key={g.id}
              style={[s.tab, selectedGenre === g.id && s.tabActive]}
              onPress={() => setSelectedGenre(g.id)}
            >
              <Text
                style={[s.tabText, selectedGenre === g.id && s.tabTextActive]}
              >
                {g.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color="#6c47ff" />
        </View>
      ) : (
        <FlatList
          data={games}
          keyExtractor={(g, i) => `${g.igdbId ?? g.steamAppId ?? i}`}
          numColumns={3}
          contentContainerStyle={s.grid}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={<Text style={s.empty}>No games found.</Text>}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color="#6c47ff" style={{ marginVertical: 16 }} />
            ) : null
          }
          renderItem={({ item }) => (
            <DiscoverCard
              game={item}
              onPress={() => {
                if (item.libraryId) {
                  nav.navigate("GameDetail", { gameId: item.libraryId });
                }
              }}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function DiscoverCard({
  game,
  onPress,
}: {
  game: DiscoverGame;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={s.coverCell} onPress={onPress} disabled={!game.libraryId}>
      {game.coverUrl ? (
        <Image
          source={{ uri: game.coverUrl }}
          style={s.coverImg}
          contentFit="cover"
        />
      ) : (
        <View style={[s.coverImg, s.coverFallback]}>
          <Text style={s.coverFallbackText} numberOfLines={3}>
            {game.name}
          </Text>
        </View>
      )}
      {game.libraryId && (
        <View style={s.inLibraryDot} />
      )}
      <Text style={s.coverLabel} numberOfLines={2}>
        {game.name}
      </Text>
      {game.year && <Text style={s.coverYear}>{game.year}</Text>}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1c1e26" },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: "900", color: "#f0f0f6" },

  tabRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "#1e2029",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  tabActive: { backgroundColor: "#6c47ff", borderColor: "#6c47ff" },
  tabText: { fontSize: 12, color: "#888" },
  tabTextActive: { color: "#fff", fontWeight: "700" },

  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  empty: { color: "#888", textAlign: "center", marginTop: 40, fontSize: 14 },

  grid: { paddingHorizontal: 12, paddingBottom: 32 },
  coverCell: { flex: 1, margin: 4, maxWidth: "33.33%" },
  coverImg: { width: "100%", aspectRatio: 3 / 4, borderRadius: 6 },
  coverFallback: {
    backgroundColor: "#323440",
    justifyContent: "center",
    alignItems: "center",
    padding: 6,
  },
  coverFallbackText: { fontSize: 10, color: "#888", textAlign: "center" },
  coverLabel: { fontSize: 11, color: "#d7d8e2", marginTop: 4, lineHeight: 14 },
  coverYear: { fontSize: 10, color: "#888", marginTop: 1 },
  inLibraryDot: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#4caf50",
  },
});
