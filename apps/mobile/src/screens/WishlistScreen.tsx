import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
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
import type { LibraryGame, WishlistPrice, QuestListDetail } from "../lib/api";
import { imgUrl } from "../lib/img";
import { formatDate } from "../lib/format";
import type { SharedDetailParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<SharedDetailParamList>;

interface WishlistEntry {
  game: LibraryGame;
  price: WishlistPrice | null;
}

export default function WishlistScreen() {
  const { token } = useAuth();
  const nav = useNavigation<Nav>();

  const [entries, setEntries] = useState<WishlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    // Wishlist is the system list with systemKey === 'wishlist'
    const lists = await api.getLists(token);
    const wishlist = lists.find((l) => l.systemKey === "wishlist");
    if (!wishlist) {
      setEntries([]);
      return;
    }
    const detail: QuestListDetail = await api.getListDetail(wishlist.id, token);
    const games = detail.games ?? [];
    // Fetch prices in parallel (best-effort)
    const priceResults = await Promise.allSettled(
      games.map((g) => api.getWishlistPrice(g.id, token))
    );
    setEntries(
      games.map((g, i) => ({
        game: g,
        price:
          priceResults[i].status === "fulfilled"
            ? (priceResults[i] as PromiseFulfilledResult<WishlistPrice>).value
            : null,
      }))
    );
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
      <FlatList
        data={entries}
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
            <Text style={s.title}>Wishlist</Text>
            <Text style={s.count}>{entries.length} games</Text>
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
              {item.game.firstReleaseDate && (
                <Text style={s.releaseDate}>
                  {formatDate(item.game.firstReleaseDate)}
                </Text>
              )}
              {item.price?.current ? (
                <Text style={s.price}>
                  ${item.price.current.price.toFixed(2)} · {item.price.current.shop}
                </Text>
              ) : item.price ? (
                <Text style={s.priceNA}>Not currently listed</Text>
              ) : (
                <Text style={s.priceNA}>No price data</Text>
              )}
              {item.price?.lowest && (
                <Text style={s.priceLowest}>
                  Historical low: ${item.price.lowest.price.toFixed(2)}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1c1e26" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1c1e26",
  },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: "900", color: "#f0f0f6" },
  count: { color: "#888", fontSize: 13, marginTop: 2 },
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
  coverFallback: { backgroundColor: "#323440" },
  info: { flex: 1 },
  name: { color: "#f0f0f6", fontSize: 14, fontWeight: "600" },
  releaseDate: { color: "#888", fontSize: 11, marginTop: 2 },
  price: { color: "#4caf50", fontSize: 12, marginTop: 3 },
  priceNA: { color: "#555", fontSize: 12, marginTop: 3 },
  priceLowest: { color: "#888", fontSize: 11, marginTop: 1 },
});
