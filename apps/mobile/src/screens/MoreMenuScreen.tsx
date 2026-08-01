import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { MoreStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<MoreStackParamList>;

const MENU_ITEMS: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  screen: keyof MoreStackParamList;
}[] = [
  { label: "Search", icon: "search-outline", screen: "Search" },
  { label: "Discover", icon: "compass-outline", screen: "Discover" },
  { label: "Stats", icon: "bar-chart-outline", screen: "Stats" },
  { label: "Settings", icon: "settings-outline", screen: "Settings" },
];

export default function MoreMenuScreen() {
  const nav = useNavigation<Nav>();

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Text style={s.title}>More</Text>
      </View>
      <View style={s.list}>
        {MENU_ITEMS.map((item) => (
          <TouchableOpacity
            key={item.screen}
            style={s.row}
            onPress={() => nav.navigate(item.screen as any)}
          >
            <View style={s.iconWrap}>
              <Ionicons name={item.icon} size={22} color="#6c47ff" />
            </View>
            <Text style={s.label}>{item.label}</Text>
            <Ionicons name="chevron-forward" size={18} color="#888" />
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1b2838" },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: "900", color: "#f0f0f6" },
  list: { paddingHorizontal: 16, paddingTop: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(108,71,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  label: { flex: 1, color: "#f0f0f6", fontSize: 16, fontWeight: "600" },
});
