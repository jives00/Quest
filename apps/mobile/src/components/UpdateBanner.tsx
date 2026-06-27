import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUpdateStore } from "../store/update";

export default function UpdateBanner() {
  const insets = useSafeAreaInsets();
  const { updateAvailable, dismissed, downloading, progress, startUpdate, dismiss } =
    useUpdateStore();

  if (!updateAvailable || dismissed) return null;

  return (
    <View style={[s.banner, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity style={s.main} onPress={startUpdate} disabled={downloading}>
        {downloading ? (
          <Text style={s.text}>Downloading… {Math.round(progress * 100)}%</Text>
        ) : (
          <Text style={s.text}>Update available — tap to install</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity style={s.close} onPress={dismiss} hitSlop={8}>
        <Text style={s.closeText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    backgroundColor: "#6c47ff",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  main: { flex: 1 },
  text: { color: "#fff", fontWeight: "700", fontSize: 13 },
  close: { paddingLeft: 12 },
  closeText: { color: "rgba(255,255,255,0.8)", fontSize: 16, fontWeight: "700" },
});
