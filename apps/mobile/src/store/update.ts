import { create } from "zustand";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { resolveApiBase } from "../lib/apiBase";

export const BUILD_TAG = process.env.EXPO_PUBLIC_BUILD_TAG ?? "";

interface UpdateState {
  updateAvailable: boolean;
  apkUrl: string;
  latestTag: string;
  downloading: boolean;
  progress: number;
  dismissed: boolean;
  checking: boolean;
}

interface UpdateActions {
  checkForUpdate: () => Promise<void>;
  startUpdate: () => Promise<void>;
  dismiss: () => void;
}

export const useUpdateStore = create<UpdateState & UpdateActions>((set, get) => ({
  updateAvailable: false,
  apkUrl: "",
  latestTag: "",
  downloading: false,
  progress: 0,
  dismissed: false,
  checking: false,

  checkForUpdate: async () => {
    if (!BUILD_TAG) return;
    set({ checking: true });
    try {
      const base = await resolveApiBase();
      if (!base) return; // off-network — skip the update check
      const res = await fetch(`${base}/api/app/version`);
      if (!res.ok) return;
      const { tag, apkUrl } = (await res.json()) as { tag: string; apkUrl: string };
      set({ latestTag: tag, apkUrl, updateAvailable: tag !== BUILD_TAG, dismissed: false });
    } catch {
      // ignore network errors
    } finally {
      set({ checking: false });
    }
  },

  startUpdate: async () => {
    const { apkUrl } = get();
    if (!apkUrl) return;
    set({ downloading: true, progress: 0 });
    try {
      const dest = `${FileSystem.documentDirectory}update.apk`;
      const download = FileSystem.createDownloadResumable(apkUrl, dest, {}, (snap) => {
        set({ progress: snap.totalBytesWritten / snap.totalBytesExpectedToWrite });
      });
      const result = await download.downloadAsync();
      if (!result?.uri) return;
      const contentUri = await FileSystem.getContentUriAsync(result.uri);
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        flags: 1,
        type: "application/vnd.android.package-archive",
      });
    } catch {
      // ignore
    } finally {
      set({ downloading: false, progress: 0 });
    }
  },

  dismiss: () => set({ dismissed: true }),
}));
