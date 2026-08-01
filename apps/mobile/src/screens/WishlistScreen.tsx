import { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import type { LibraryGame, WishlistPrice, QuestListDetail } from "../lib/api";
import { imgUrl } from "../lib/img";
import { formatDate } from "../lib/format";
import type { SharedDetailParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<SharedDetailParamList>;

type SortKey = "alpha" | "release" | "rating" | "price";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "alpha", label: "A–Z" },
  { key: "release", label: "Release" },
  { key: "rating", label: "Rating" },
  { key: "price", label: "Price" },
];

interface WishlistEntry {
  game: LibraryGame;
  price: WishlistPrice | null;
  priceLoading: boolean;
}

function sortEntries(entries: WishlistEntry[], sort: SortKey): WishlistEntry[] {
  return [...entries].sort((a, b) => {
    switch (sort) {
      case "alpha":
        return a.game.title.localeCompare(b.game.title);
      case "release": {
        const ad = a.game.firstReleaseDate ?? null;
        const bd = b.game.firstReleaseDate ?? null;
        if (!ad && !bd) return 0;
        if (!ad) return 1;
        if (!bd) return -1;
        return bd.localeCompare(ad);
      }
      case "rating": {
        const ar = a.game.metacritic ?? null;
        const br = b.game.metacritic ?? null;
        if (ar == null && br == null) return 0;
        if (ar == null) return 1;
        if (br == null) return -1;
        return br - ar;
      }
      case "price": {
        const ap = a.price?.current?.price ?? null;
        const bp = b.price?.current?.price ?? null;
        if (ap == null && bp == null) return 0;
        if (ap == null) return 1;
        if (bp == null) return -1;
        return ap - bp;
      }
    }
  });
}

export default function WishlistScreen() {
  const { token } = useAuth();
  const nav = useNavigation<Nav>();

  const [entries, setEntries] = useState<WishlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<SortKey>("alpha");

  const load = useCallback(async () => {
    if (!token) return;
    const lists = await api.getLists(token);
    const wishlist = lists.find((l) => l.systemKey === "wishlist");
    if (!wishlist) {
      setEntries([]);
      return;
    }
    const detail: QuestListDetail = await api.getListDetail(wishlist.id, token);
    const games = detail.games ?? [];
    // Render games immediately with price placeholders, then fill prices in as they arrive.
    setEntries(games.map((g) => ({ game: g, price: null, priceLoading: true })));
    for (const g of games) {
      api.getWishlistPrice(g.id, token)
        .then((price) => {
          setEntries((prev) =>
            prev.map((e) => (e.game.id === g.id ? { ...e, price, priceLoading: false } : e))
          );
        })
        .catch(() => {
          setEntries((prev) =>
            prev.map((e) => (e.game.id === g.id ? { ...e, price: null, priceLoading: false } : e))
          );
        });
    }
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

  const sorted = useMemo(() => sortEntries(entries, sort), [entries, sort]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#6c47ff" />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <FlatList
        data={sorted}
        keyExtractor={(e) => String(e.game.id)}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#6c47ff"
            colors={["#6c47ff"]}
          />
        }
        ListHeaderComponent={
          <View style={s.header}>
            <View style={s.headerTop}>
              <Text style={s.title}>Wishlist</Text>
              <Text style={s.count}>{entries.length} games</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.sortRow}
            >
              {SORT_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.key}
                  onPress={() => setSort(o.key)}
                  style={[s.sortChip, sort === o.key && s.sortChipActive]}
                >
                  <Text style={[s.sortChipText, sort === o.key && s.sortChipTextActive]}>
                    {o.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          <Text style={s.empty}>Your wishlist is empty.</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.row}
            onPress={() =>
              nav.navigate("GameDetail", { gameId: item.game.id })
            }
          >
            {imgUrl(item.game.coverPath) ? (
              <Image
                source={{ uri: imgUrl(item.game.coverPath)! }}
                style={s.cover}
                contentFit="cover"
              />
            ) : (
              <View style={[s.cover, s.coverFallback]} />
            )}
            <View style={s.info}>
              <Text style={s.name} numberOfLines={2}>
                {item.game.title}
              </Text>
              <Text style={s.releaseDate}>
                {item.game.firstReleaseDate ? formatDate(item.game.firstReleaseDate) : "TBD"}
              </Text>
              {item.game.metacritic != null && (
                <Text style={s.rating}>MC {item.game.metacritic}</Text>
              )}
              {item.priceLoading ? (
                <View style={s.pricePlaceholder} />
              ) : item.price ? (
                <Text style={item.price.current ? s.price : s.priceNA}>
                  {item.price.current
                    ? `$${item.price.current.price.toFixed(2)} · ${item.price.current.shop}`
                    : "Not currently listed"}
                  {item.price.lowest
                    ? ` | Low $${item.price.lowest.price.toFixed(2)}`
                    : ""}
                </Text>
              ) : (
                <Text style={s.priceNA}>No price data</Text>
              )}
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1b2838" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1b2838",
  },
  header: { paddingTop: 16, paddingBottom: 4 },
  headerTop: { paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: "900", color: "#f0f0f6" },
  count: { color: "#888", fontSize: 13, marginTop: 2 },
  sortRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  sortChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "#2a2d3a",
  },
  sortChipActive: { backgroundColor: "#6c47ff" },
  sortChipText: { color: "#888", fontSize: 13, fontWeight: "600" },
  sortChipTextActive: { color: "#fff" },
  list: { paddingBottom: 32 },
  empty: { color: "#888", textAlign: "center", marginTop: 40, fontSize: 14 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  cover: { width: 44, height: 58, borderRadius: 4 },
  coverFallback: { backgroundColor: "#313e52" },
  info: { flex: 1 },
  name: { color: "#f0f0f6", fontSize: 14, fontWeight: "600" },
  releaseDate: { color: "#888", fontSize: 11, marginTop: 2 },
  rating: { color: "#aaa", fontSize: 11, marginTop: 2 },
  price: { color: "#4caf50", fontSize: 12, marginTop: 3 },
  priceNA: { color: "#555", fontSize: 12, marginTop: 3 },
  pricePlaceholder: {
    width: 90,
    height: 12,
    borderRadius: 4,
    backgroundColor: "#2a2d3a",
    marginTop: 5,
  },
});
