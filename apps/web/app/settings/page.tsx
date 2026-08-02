"use client";

// Explicit type import, not the ambient React namespace -- see the note in
// lib/auth-context.tsx: the ambient namespace resolves to React 19's types via
// Next's own declarations, which are incompatible with the React 18 types an
// explicit import gives you.
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { IconPicker } from "@/components/icon-picker";
import { PlatformIcon } from "@/components/icon-picker/render";
import {
  api,
  PLATFORM_LABELS,
  type PlatformAccount,
  type ProvisionalMatch,
  type DuplicateCandidate,
  type IgdbSearchResult,
  type ImportSource,
  type Platform,
  type UserPlatform,
  type PlatformOverride,
} from "@/lib/api";

export const dynamic = "force-dynamic";

const HEALTH_CHIP: Record<string, string> = {
  green: "bg-accent/20 text-accent",
  amber: "bg-yellow-500/20 text-yellow-400",
  red: "bg-red-500/20 text-red-400",
};

const MAIN_TABS: { id: "account" | "platforms" | "integrations" | "imports" | "matching" | "export"; label: string; icon: string }[] = [
  { id: "account",      label: "Account",          icon: "manage_accounts" },
  { id: "platforms",    label: "Platforms",         icon: "devices" },
  { id: "integrations", label: "Integrations",      icon: "sync" },
  { id: "imports",      label: "Library Imports",   icon: "upload_file" },
  { id: "matching",     label: "Matching Review",   icon: "rule" },
  { id: "export",       label: "Export",            icon: "download" },
];

export default function SettingsPage() {
  const router = useRouter();
  const { token, isLoading } = useAuth();

  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [userPlatforms, setUserPlatforms] = useState<UserPlatform[]>([]);
  const [steamId, setSteamId] = useState("");
  const [savingSteam, setSavingSteam] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [mainTab, setMainTab] = useState<"account" | "platforms" | "integrations" | "imports" | "matching" | "export">("account");
  const [tab, setTab] = useState<"provisional" | "duplicates" | "merge">("provisional");
  const [provisional, setProvisional] = useState<ProvisionalMatch[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);

  useEffect(() => {
    if (!isLoading && !token) router.push("/login");
  }, [token, isLoading, router]);

  function reload() {
    if (!token) return;
    api.getPlatforms(token).then((a) => {
      setAccounts(a);
      const steam = a.find((x) => x.platform === "steam");
      if (steam?.steamId64) setSteamId(steam.steamId64);
    }).catch((err) => console.error("Platforms load error:", err));
    api.getUserPlatforms(token).then(setUserPlatforms).catch(() => {});
    api.getProvisionalMatches(token).then(setProvisional).catch((err) => console.error(err));
    api.getDuplicates(token).then(setDuplicates).catch((err) => console.error(err));
  }

  useEffect(reload, [token]);

  async function saveSteam() {
    if (!token || !/^\d{17}$/.test(steamId)) return;
    setSavingSteam(true);
    try {
      await api.setSteamAccount(steamId, true, token);
      reload();
    } catch (err) {
      console.error("Save Steam error:", err);
    } finally {
      setSavingSteam(false);
    }
  }

  async function syncSteam() {
    if (!token) return;
    setSyncing(true);
    try {
      await api.syncPlatform("steam", token);
      reload();
    } catch (err) {
      console.error("Sync error:", err);
    } finally {
      setSyncing(false);
    }
  }

  if (isLoading || !token) return null;

  const steam = accounts.find((a) => a.platform === "steam");
  const psn = accounts.find((a) => a.platform === "psn");
  const xbox = accounts.find((a) => a.platform === "xbox");

  return (
    <div className="flex flex-1 min-h-0">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-outline-variant/20 bg-surface-container-lowest sticky top-16 self-start h-[calc(100vh-4rem)] overflow-y-auto">
        <div className="p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface/40 mb-3 px-2">Settings</p>
          <nav className="flex flex-col gap-0.5">
            {MAIN_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setMainTab(t.id)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-left w-full transition-colors ${
                  mainTab === t.id
                    ? "bg-accent/15 text-accent"
                    : "text-on-surface/60 hover:text-on-surface hover:bg-on-surface/5"
                }`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {mainTab === "account" && (
          <AccountPanel token={token} />
        )}

        {mainTab === "platforms" && (
          <PlatformsPanel token={token} />
        )}

        {mainTab === "integrations" && (
          <div className="px-8 py-8">
            <h1 className="text-2xl font-black tracking-tight text-on-surface mb-6">Integrations</h1>
            <div className="flex flex-col gap-4 max-w-2xl">
              <div className="bg-surface-container-low border border-outline-variant/20 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold text-on-surface">Steam</span>
                  {steam && (
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded ${HEALTH_CHIP[steam.health]}`}>
                      {steam.health === "red" ? "needs attention" : steam.health}
                    </span>
                  )}
                </div>
                {steam?.lastError && <p className="text-xs text-red-400 mb-3">{steam.lastError}</p>}
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    value={steamId}
                    onChange={(e) => setSteamId(e.target.value)}
                    placeholder="17-digit SteamID64"
                    className="flex-1 min-w-[16rem] bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={saveSteam}
                    disabled={savingSteam || !/^\d{17}$/.test(steamId)}
                    className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
                  >
                    {savingSteam ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={syncSteam}
                    disabled={syncing || !steam?.steamId64}
                    className="px-4 py-2 rounded-lg bg-surface-container border border-outline-variant/40 text-on-surface text-sm font-bold hover:border-accent transition-colors disabled:opacity-50"
                  >
                    {syncing ? "Syncing…" : "Sync now"}
                  </button>
                </div>
                {steam?.lastSyncedAt && (
                  <p className="text-xs text-on-surface/40 mt-3">Last synced {new Date(steam.lastSyncedAt).toLocaleString()}</p>
                )}
              </div>
              <PsnCard account={psn} token={token} onChange={reload} />
              <XboxCard account={xbox} token={token} onChange={reload} />
            </div>
          </div>
        )}

        {mainTab === "imports" && (
          <div className="px-8 py-8">
            <h1 className="text-2xl font-black tracking-tight text-on-surface mb-1">Library Imports</h1>
            <p className="text-xs text-on-surface/40 mb-6">
              These stores have no playtime API — import an owned-games list once, then maintain by hand.
              Paste one title per line (optionally <code>title,externalId</code>).
            </p>
            <ManualImportPanel accounts={accounts} token={token} onChange={reload} userPlatforms={userPlatforms} />
          </div>
        )}

        {mainTab === "export" && (
          <ExportPanel token={token} />
        )}

        {mainTab === "matching" && (
          <div className="px-8 py-8">
            <h1 className="text-2xl font-black tracking-tight text-on-surface mb-6">Matching Review</h1>
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setTab("provisional")}
                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors ${
                  tab === "provisional" ? "bg-accent text-white" : "bg-surface-container text-on-surface/60 hover:text-on-surface"
                }`}
              >
                Provisional ({provisional.length})
              </button>
              <button
                onClick={() => setTab("duplicates")}
                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors ${
                  tab === "duplicates" ? "bg-accent text-white" : "bg-surface-container text-on-surface/60 hover:text-on-surface"
                }`}
              >
                Duplicates ({duplicates.length})
              </button>
              <button
                onClick={() => setTab("merge")}
                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors ${
                  tab === "merge" ? "bg-accent text-white" : "bg-surface-container text-on-surface/60 hover:text-on-surface"
                }`}
              >
                Manual merge
              </button>
            </div>

            {tab === "provisional" ? (
              <div className="flex flex-col gap-3">
                {provisional.length === 0 ? (
                  <p className="text-on-surface/40 text-sm">No provisional games — everything is matched.</p>
                ) : (
                  provisional.map((p) => (
                    <ProvisionalRow key={p.gameId} match={p} token={token} onResolved={reload} />
                  ))
                )}
              </div>
            ) : tab === "duplicates" ? (
              <div className="flex flex-col gap-3">
                {duplicates.length === 0 ? (
                  <p className="text-on-surface/40 text-sm">No likely duplicates detected.</p>
                ) : (
                  duplicates.map((d, i) => (
                    <DuplicateRow key={i} cand={d} token={token} onMerged={reload} />
                  ))
                )}
              </div>
            ) : (
              <ManualMergePanel token={token} onMerged={reload} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

const BUILTIN_PLATFORMS: { slug: string; label: string; integration: string }[] = [
  { slug: "steam",      label: "Windows / Steam",  integration: "Integrations" },
  { slug: "psn",        label: "PlayStation",       integration: "Integrations" },
  { slug: "xbox",       label: "Xbox / Game Pass",  integration: "Integrations" },
  { slug: "epic",       label: "Epic Games",        integration: "Library Imports" },
  { slug: "gog",        label: "GOG",               integration: "Library Imports" },
  { slug: "meta_quest", label: "Meta Quest",        integration: "Library Imports" },
];

const BUILTIN_PLATFORM_ICONS: Record<string, ReactNode> = {
  steam: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="w-5 h-5"><path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z" /></svg>,
  psn: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="w-5 h-5"><path d="M8.985 2.596v17.548l3.915 1.261V6.688c0-.69.304-1.151.794-.998.636.19.762.84.762 1.529v5.372c2.689 1.088 4.718-.169 4.718-3.53 0-3.44-1.194-4.988-4.688-6.076 0 0-3.037-.987-5.501-.389zM7.641 20.26c-2.69.239-4.73-1.075-4.73-2.963 0-1.79 1.567-3.272 4.33-3.862v2.01c-1.213.353-2.148.965-2.148 1.894 0 .995 1.002 1.494 2.548 1.214v1.707z" /></svg>,
  xbox: <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className="w-5 h-5"><path d="M7.202 15.967a8 8 0 0 1-3.552-1.26c-.898-.585-1.101-.826-1.101-1.306 0-.965 1.062-2.656 2.879-4.583C6.459 7.723 7.897 6.44 8.052 6.475c.302.068 2.718 2.423 3.622 3.531 1.43 1.753 2.088 3.189 1.754 3.829-.254.486-1.83 1.437-2.987 1.802-.954.301-2.207.429-3.239.33m-5.866-3.57C.589 11.253.212 10.127.03 8.497c-.06-.539-.038-.846.137-1.95.218-1.377 1.002-2.97 1.945-3.95.401-.417.437-.427.926-.263.595.2 1.23.638 2.213 1.528l.574.519-.313.385C4.056 6.553 2.52 9.086 1.94 10.653c-.315.852-.442 1.707-.306 2.063.091.24.007.15-.3-.319Zm13.101.195c.074-.36-.019-1.02-.238-1.687-.473-1.443-2.055-4.128-3.508-5.953l-.457-.575.494-.454c.646-.593 1.095-.948 1.58-1.25.381-.237.927-.448 1.161-.448.145 0 .654.528 1.065 1.104a8.4 8.4 0 0 1 1.343 3.102c.153.728.166 2.286.024 3.012a9.5 9.5 0 0 1-.6 1.893c-.179.393-.624 1.156-.82 1.404-.1.128-.1.127-.043-.148ZM7.335 1.952c-.67-.34-1.704-.705-2.276-.803a4 4 0 0 0-.759-.043c-.471.024-.45 0 .306-.358A7.8 7.8 0 0 1 6.47.128c.8-.169 2.306-.17 3.094-.005.85.18 1.853.552 2.418.9l.168.103-.385-.02c-.766-.038-1.88.27-3.078.853-.361.176-.676.316-.699.312a12 12 0 0 1-.654-.319Z" /></svg>,
  epic: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="w-5 h-5"><path d="M3.537 0C2.165 0 1.66.506 1.66 1.879V18.44a4.262 4.262 0 00.02.433c.031.3.037.59.316.92.027.033.311.245.311.245.153.075.258.13.43.2l8.335 3.491c.433.199.614.276.928.27h.002c.314.006.495-.071.928-.27l8.335-3.492c.172-.07.277-.124.43-.2 0 0 .284-.211.311-.243.28-.33.285-.621.316-.92a4.261 4.261 0 00.02-.434V1.879c0-1.373-.506-1.88-1.878-1.88zm13.366 3.11h.68c1.138 0 1.688.553 1.688 1.696v1.88h-1.374v-1.8c0-.369-.17-.54-.523-.54h-.235c-.367 0-.537.17-.537.539v5.81c0 .369.17.54.537.54h.262c.353 0 .523-.171.523-.54V8.619h1.373v2.143c0 1.144-.562 1.71-1.7 1.71h-.694c-1.138 0-1.7-.566-1.7-1.71V4.82c0-1.144.562-1.709 1.7-1.709zm-12.186.08h3.114v1.274H6.117v2.603h1.648v1.275H6.117v2.774h1.74v1.275h-3.14zm3.816 0h2.198c1.138 0 1.7.564 1.7 1.708v2.445c0 1.144-.562 1.71-1.7 1.71h-.799v3.338h-1.4zm4.53 0h1.4v9.201h-1.4zm-3.13 1.235v3.392h.575c.354 0 .523-.171.523-.54V4.965c0-.368-.17-.54-.523-.54z" /></svg>,
  gog: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="w-5 h-5"><path d="M7.15 15.24H4.36a.4.4 0 0 0-.4.4v2c0 .21.18.4.4.4h2.8v1.32h-3.5c-.56 0-1.02-.46-1.02-1.03v-3.39c0-.56.46-1.02 1.03-1.02h3.48v1.32zM8.16 11.54c0 .58-.47 1.05-1.05 1.05H2.63v-1.35h3.78a.4.4 0 0 0 .4-.4V6.39a.4.4 0 0 0-.4-.4H4.39a.4.4 0 0 0-.41.4v2.02c0 .23.18.4.4.4H6v1.35H3.68c-.58 0-1.05-.46-1.05-1.04V5.68c0-.57.47-1.04 1.05-1.04H7.1c.58 0 1.05.47 1.05 1.04v5.86zM21.36 19.36h-1.32v-4.12h-.93a.4.4 0 0 0-.4.4v3.72h-1.33v-4.12h-.93a.4.4 0 0 0-.4.4v3.72h-1.33v-4.42c0-.56.46-1.02 1.03-1.02h5.61v5.44zM21.37 11.54c0 .58-.47 1.05-1.05 1.05h-4.48v-1.35h3.78a.4.4 0 0 0 .4-.4V6.39a.4.4 0 0 0-.4-.4h-2.03a.4.4 0 0 0-.4.4v2.02c0 .23.18.4.4.4h1.62v1.35H16.9c-.58 0-1.05-.46-1.05-1.04V5.68c0-.57.47-1.04 1.05-1.04h3.43c.58 0 1.05.47 1.05 1.04v5.86z" /></svg>,
  meta_quest: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="w-5 h-5"><path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303z" /></svg>,
};

type EditingState =
  | { kind: "builtin"; slug: Platform }
  | { kind: "custom"; id: number };

function PlatformRow({
  icon,
  name,
  badge,
  onEdit,
  onDelete,
}: {
  icon: ReactNode;
  name: string;
  badge?: string;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-surface-container-low border border-outline-variant/20">
      <span className="shrink-0 w-7 flex items-center justify-center text-on-surface/60">{icon}</span>
      <span className="text-sm font-medium text-on-surface flex-1">{name}</span>
      {badge && (
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 border border-outline-variant/30 px-2 py-0.5 rounded">
          {badge}
        </span>
      )}
      <button onClick={onEdit} className="text-on-surface/30 hover:text-on-surface transition-colors" title="Edit">
        <span className="material-symbols-outlined text-base">edit</span>
      </button>
      {onDelete && (
        <button onClick={onDelete} className="text-on-surface/30 hover:text-red-400 transition-colors" title="Remove">
          <span className="material-symbols-outlined text-base">delete</span>
        </button>
      )}
    </div>
  );
}

function EditRow({
  iconValue,
  nameValue,
  onIconChange,
  onNameChange,
  onSave,
  onCancel,
  namePlaceholder,
  svgPreview,
}: {
  iconValue: string;
  nameValue: string;
  onIconChange: (v: string) => void;
  onNameChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  namePlaceholder?: string;
  svgPreview?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 bg-surface-container-low border border-accent/30">
      <IconPicker value={iconValue} onChange={onIconChange} svgPreview={svgPreview} />
      <input
        value={nameValue}
        onChange={(e) => onNameChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
        placeholder={namePlaceholder}
        maxLength={64}
        className="flex-1 bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-1.5 text-on-surface text-sm focus:outline-none focus:border-accent"
        autoFocus
      />
      <button onClick={onSave} className="text-accent hover:text-accent/70 transition-colors">
        <span className="material-symbols-outlined text-base">check</span>
      </button>
      <button onClick={onCancel} className="text-on-surface/30 hover:text-on-surface transition-colors">
        <span className="material-symbols-outlined text-base">close</span>
      </button>
    </div>
  );
}

function PlatformsPanel({ token }: { token: string }) {
  const [platforms, setPlatforms] = useState<UserPlatform[]>([]);
  const [overrides, setOverrides] = useState<PlatformOverride[]>([]);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState("");

  useEffect(() => {
    Promise.all([api.getUserPlatforms(token), api.getPlatformOverrides(token)])
      .then(([p, o]) => { setPlatforms(p); setOverrides(o); })
      .catch(() => {});
  }, [token]);

  function getOverride(slug: Platform) {
    return overrides.find((o) => o.platform === slug) ?? null;
  }

  function startEditBuiltin(slug: Platform) {
    const ov = getOverride(slug);
    const bp = BUILTIN_PLATFORMS.find((p) => p.slug === slug)!;
    setEditing({ kind: "builtin", slug });
    setEditName(ov?.name ?? bp.label);
    setEditIcon(ov?.icon ?? "");
  }

  async function saveEditBuiltin(slug: Platform) {
    try {
      await api.setPlatformOverride(slug, { name: editName.trim() || null, icon: editIcon.trim() || null }, token);
      const n = editName.trim() || null;
      const ic = editIcon.trim() || null;
      setOverrides((prev) => {
        if (prev.find((o) => o.platform === slug)) return prev.map((o) => o.platform === slug ? { ...o, name: n, icon: ic } : o);
        return [...prev, { platform: slug, name: n, icon: ic }];
      });
      setEditing(null);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to save");
    }
  }

  function startEditCustom(p: UserPlatform) {
    setEditing({ kind: "custom", id: p.id });
    setEditName(p.name);
    setEditIcon(p.icon ?? "");
  }

  async function saveEditCustom(id: number) {
    const name = editName.trim();
    if (!name) return;
    try {
      await api.updateUserPlatform(id, { name, icon: editIcon.trim() || null }, token);
      setPlatforms((prev) => prev.map((p) => p.id === id ? { ...p, name, icon: editIcon.trim() || null } : p));
      setEditing(null);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to save");
    }
  }

  async function remove(id: number) {
    try {
      await api.deleteUserPlatform(id, token);
      setPlatforms((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to remove platform");
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setMsg(null);
    try {
      const p = await api.addUserPlatform(name, newIcon.trim() || null, token);
      setPlatforms((prev) => [...prev, { ...p, sortOrder: 0, createdAt: new Date().toISOString() }]);
      setNewName("");
      setNewIcon("");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to add platform");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-8 py-8">
      <h1 className="text-2xl font-black tracking-tight text-on-surface mb-1">Platforms</h1>
      <p className="text-sm text-on-surface/50 mb-8">
        Rename any platform or give it a custom icon. Built-in platforms sync automatically;
        custom platforms are manually maintained.
      </p>

      <div className="flex flex-col gap-2 max-w-xl mb-8">
        {BUILTIN_PLATFORMS.map((bp) => {
          const slug = bp.slug as Platform;
          const ov = getOverride(slug);
          const displayName = ov?.name ?? bp.label;
          const svgIcon = BUILTIN_PLATFORM_ICONS[bp.slug];
          const displayIcon = ov?.icon ? <PlatformIcon value={ov.icon} size={20} /> : svgIcon;

          if (editing?.kind === "builtin" && editing.slug === slug) {
            return (
              <EditRow
                key={bp.slug}
                iconValue={editIcon}
                nameValue={editName}
                onIconChange={setEditIcon}
                onNameChange={setEditName}
                onSave={() => saveEditBuiltin(slug)}
                onCancel={() => setEditing(null)}
                namePlaceholder={bp.label}
                svgPreview={svgIcon}
              />
            );
          }
          return (
            <PlatformRow
              key={bp.slug}
              icon={displayIcon}
              name={displayName}
              badge={bp.integration}
              onEdit={() => startEditBuiltin(slug)}
            />
          );
        })}

        {platforms.map((p) => {
          if (editing?.kind === "custom" && editing.id === p.id) {
            return (
              <EditRow
                key={p.id}
                iconValue={editIcon}
                nameValue={editName}
                onIconChange={setEditIcon}
                onNameChange={setEditName}
                onSave={() => saveEditCustom(p.id)}
                onCancel={() => setEditing(null)}
                namePlaceholder={p.name}
              />
            );
          }
          return (
            <PlatformRow
              key={p.id}
              icon={<PlatformIcon value={p.icon} fallback="🎮" size={20} />}
              name={p.name}
              onEdit={() => startEditCustom(p)}
              onDelete={() => remove(p.id)}
            />
          );
        })}
      </div>

      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-3">Add custom platform</p>
      <form onSubmit={add} className="flex gap-2 max-w-xl">
        <input
          value={newIcon}
          onChange={(e) => setNewIcon(e.target.value)}
          placeholder="🎮"
          maxLength={4}
          className="w-14 bg-surface-container border border-outline-variant/40 rounded-lg px-2 py-2 text-on-surface text-sm text-center focus:outline-none focus:border-accent"
        />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="e.g. Nintendo Switch, PS Vita, Arcade…"
          maxLength={64}
          className="flex-1 bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || !newName.trim()}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </form>
      {msg && <p className="text-xs mt-2 text-red-400">{msg}</p>}
    </div>
  );
}

function AccountPanel({ token }: { token: string }) {
  const [username, setUsername] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    api.getMe(token).then((u) => {
      setUsername(u.username);
      setNewUsername(u.username);
    }).catch(() => {});
  }, [token]);

  async function saveUsername(e: React.FormEvent) {
    e.preventDefault();
    if (newUsername.trim() === username) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.updateAccount({ newUsername: newUsername.trim() }, token);
      setUsername(newUsername.trim());
      setMsg({ text: "Username updated.", ok: true });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed", ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setMsg({ text: "Passwords do not match.", ok: false });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api.updateAccount({ currentPassword, newPassword }, token);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMsg({ text: "Password updated.", ok: true });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed", ok: false });
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "w-full bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent";
  const labelCls = "block text-xs font-semibold text-on-surface/50 mb-1";

  return (
    <div className="px-8 py-8">
      <h1 className="text-2xl font-black tracking-tight text-on-surface mb-6">Account</h1>
      <div className="flex flex-col gap-6 max-w-md">
        {msg && (
          <p className={`text-sm ${msg.ok ? "text-accent" : "text-red-400"}`}>{msg.text}</p>
        )}

        <div className="bg-surface-container-low border border-outline-variant/20 p-5">
          <h2 className="text-sm font-bold text-on-surface mb-4">Change username</h2>
          <form onSubmit={saveUsername} className="flex flex-col gap-3">
            <div>
              <label className={labelCls}>Username</label>
              <input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                minLength={2}
                maxLength={64}
                required
                className={inputCls}
              />
            </div>
            <button
              type="submit"
              disabled={busy || newUsername.trim() === username || newUsername.trim().length < 2}
              className="self-start px-4 py-2 rounded-lg bg-accent text-white text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {busy ? "Saving…" : "Update username"}
            </button>
          </form>
        </div>

        <div className="bg-surface-container-low border border-outline-variant/20 p-5">
          <h2 className="text-sm font-bold text-on-surface mb-4">Change password</h2>
          <form onSubmit={savePassword} className="flex flex-col gap-3">
            <div>
              <label className={labelCls}>Current password</label>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>New password</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Confirm new password</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} required className={inputCls} />
            </div>
            <button
              type="submit"
              disabled={busy || !currentPassword || !newPassword || !confirmPassword}
              className="self-start px-4 py-2 rounded-lg bg-accent text-white text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {busy ? "Saving…" : "Update password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function ExportPanel({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function doExport() {
    setBusy(true);
    setMsg(null);
    try {
      await api.exportData(token);
      setMsg("Download started.");
    } catch {
      setMsg("Export failed — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-8 py-8">
      <h1 className="text-2xl font-black tracking-tight text-on-surface mb-2">Export</h1>
      <p className="text-sm text-on-surface/50 mb-8">
        Download all your Quest data as an Excel workbook (.xlsx).
      </p>
      <div className="bg-surface-container-low border border-outline-variant/20 p-6 max-w-md">
        <h2 className="text-sm font-bold text-on-surface mb-1">Full data export</h2>
        <p className="text-xs text-on-surface/50 mb-5">
          Includes three sheets: <strong>Library</strong> (all owned games with status, playtime, rating, and completion),{" "}
          <strong>Sessions</strong> (every recorded play session), and{" "}
          <strong>Achievements</strong> (all unlocked achievements).
        </p>
        <button
          onClick={doExport}
          disabled={busy}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-base">download</span>
          {busy ? "Generating…" : "Download Excel (.xlsx)"}
        </button>
        {msg && <p className="text-xs text-on-surface/50 mt-3">{msg}</p>}
      </div>
    </div>
  );
}

function ProvisionalRow({
  match,
  token,
  onResolved,
}: {
  match: ProvisionalMatch;
  token: string;
  onResolved: () => void;
}) {
  const [query, setQuery] = useState(match.title);
  const [results, setResults] = useState<IgdbSearchResult[]>([]);
  const [busy, setBusy] = useState(false);

  async function search() {
    setBusy(true);
    try {
      setResults(await api.searchGames(query.trim(), token));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(igdbId: number) {
    setBusy(true);
    try {
      await api.resolveMatch(match.gameId, igdbId, token);
      onResolved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface-container-low border border-outline-variant/20 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-semibold text-on-surface">{match.title}</p>
          <p className="text-[11px] text-on-surface/40">{match.platform} · id {match.externalId}</p>
        </div>
      </div>
      <div className="flex gap-2 mb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-1.5 text-on-surface text-sm focus:outline-none focus:border-accent"
        />
        <button
          onClick={search}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg bg-accent/15 text-accent text-xs font-bold hover:bg-accent/25 disabled:opacity-50"
        >
          Search IGDB
        </button>
      </div>
      {results.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {results.map((r) => (
            <button
              key={r.igdbId}
              onClick={() => resolve(r.igdbId)}
              disabled={busy}
              className="flex items-center gap-3 text-left p-2 rounded hover:bg-surface-container transition-colors disabled:opacity-50"
            >
              {r.coverUrl && <img src={r.coverUrl} alt="" className="w-10 h-[52px] object-cover shrink-0" />}
              <div className="min-w-0">
                <p className="text-base text-on-surface leading-tight">{r.name}</p>
                <p className="text-xs text-on-surface/40 mt-0.5">
                  {[r.year, r.platforms.join(", ")].filter(Boolean).join(" · ")}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DuplicateRow({
  cand,
  token,
  onMerged,
}: {
  cand: DuplicateCandidate;
  token: string;
  onMerged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function merge(winnerId: number, loserId: number) {
    setBusy(true);
    try {
      await api.mergeGames(winnerId, loserId, token);
      onMerged();
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    try {
      await api.dismissDuplicate(cand.game1.id, cand.game2.id, token);
      onMerged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface-container-low border border-outline-variant/20 p-4">
      <p className="text-[11px] text-on-surface/40 mb-3">
        Possible same game · {(cand.score * 100).toFixed(0)}% title match
      </p>
      <div className="flex items-center gap-4">
        <DupSide game={cand.game1} />
        <span className="text-on-surface/30 text-xs">vs</span>
        <DupSide game={cand.game2} />
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => merge(cand.game1.id, cand.game2.id)}
          disabled={busy}
          className="flex-1 py-2 rounded-lg bg-accent/15 text-accent text-xs font-bold hover:bg-accent/25 disabled:opacity-50"
        >
          Keep &quot;{cand.game1.title}&quot;
        </button>
        <button
          onClick={() => merge(cand.game2.id, cand.game1.id)}
          disabled={busy}
          className="flex-1 py-2 rounded-lg bg-accent/15 text-accent text-xs font-bold hover:bg-accent/25 disabled:opacity-50"
        >
          Keep &quot;{cand.game2.title}&quot;
        </button>
        <button
          onClick={dismiss}
          disabled={busy}
          className="py-2 px-3 rounded-lg bg-surface-container border border-outline-variant/40 text-on-surface/50 text-xs font-bold hover:text-on-surface transition-colors disabled:opacity-50"
          title="Mark as not a duplicate — hides this pair permanently"
        >
          Not a duplicate
        </button>
      </div>
    </div>
  );
}

type LibraryHit = { id: number; title: string; coverPath: string | null };

function GamePicker({
  label, token, picked, onPick, onClear,
}: {
  label: string;
  token: string;
  picked: LibraryHit | null;
  onPick: (g: LibraryHit) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LibraryHit[]>([]);

  async function search() {
    if (!query.trim()) return;
    const games = await api.getLibrary(token, { q: query.trim(), all: true });
    setResults(games.map((g) => ({ id: g.id, title: g.title, coverPath: g.coverPath ?? null })));
  }

  const inputCls = "flex-1 bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-1.5 text-on-surface text-sm focus:outline-none focus:border-accent";

  return (
    <div className="flex-1 min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2">{label}</p>
      {picked ? (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-accent/10 border border-accent/30">
          {picked.coverPath && <img src={picked.coverPath} alt="" className="w-8 h-10 object-cover shrink-0" />}
          <span className="text-sm text-on-surface font-semibold truncate">{picked.title}</span>
          <button onClick={onClear} className="ml-auto text-on-surface/40 hover:text-on-surface material-symbols-outlined text-sm">close</button>
        </div>
      ) : (
        <>
          <div className="flex gap-2 mb-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void search()}
              placeholder="Search library…"
              className={inputCls}
            />
            <button onClick={() => void search()} className="px-3 py-1.5 rounded-lg bg-accent/15 text-accent text-xs font-bold hover:bg-accent/25">
              Search
            </button>
          </div>
          {results.length > 0 && (
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
              {results.map((g) => (
                <button key={g.id} onClick={() => onPick(g)} className="flex items-center gap-2 text-left p-2 rounded hover:bg-surface-container transition-colors">
                  {g.coverPath && <img src={g.coverPath} alt="" className="w-7 h-9 object-cover shrink-0" />}
                  <span className="text-sm text-on-surface truncate">{g.title}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ManualMergePanel({ token, onMerged }: { token: string; onMerged: () => void }) {
  const [pickedA, setPickedA] = useState<LibraryHit | null>(null);
  const [pickedB, setPickedB] = useState<LibraryHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function merge(winnerId: number, loserId: number) {
    setBusy(true);
    setMsg(null);
    try {
      await api.mergeGames(winnerId, loserId, token);
      setPickedA(null);
      setPickedB(null);
      setMsg("Merged successfully.");
      onMerged();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Merge failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface-container-low border border-outline-variant/20 p-5">
      <p className="text-xs text-on-surface/50 mb-4">
        Search for two games from your library, then choose which one to keep. All playtime, achievements, and ratings from the removed game will be merged into the kept one.
      </p>
      <div className="flex gap-6 mb-4">
        <GamePicker label="Game A" token={token} picked={pickedA} onPick={setPickedA} onClear={() => setPickedA(null)} />
        <GamePicker label="Game B" token={token} picked={pickedB} onPick={setPickedB} onClear={() => setPickedB(null)} />
      </div>
      {pickedA && pickedB && (
        <div className="flex gap-2 mt-2">
          <button onClick={() => void merge(pickedA.id, pickedB.id)} disabled={busy} className="flex-1 py-2 rounded-lg bg-accent/15 text-accent text-xs font-bold hover:bg-accent/25 disabled:opacity-50">
            Keep &quot;{pickedA.title}&quot;
          </button>
          <button onClick={() => void merge(pickedB.id, pickedA.id)} disabled={busy} className="flex-1 py-2 rounded-lg bg-accent/15 text-accent text-xs font-bold hover:bg-accent/25 disabled:opacity-50">
            Keep &quot;{pickedB.title}&quot;
          </button>
        </div>
      )}
      {msg && <p className="text-xs text-on-surface/50 mt-3">{msg}</p>}
    </div>
  );
}

function HealthChip({ account }: { account?: PlatformAccount }) {
  if (!account) return null;
  return (
    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded ${HEALTH_CHIP[account.health]}`}>
      {account.health === "red" ? "needs attention" : account.health}
    </span>
  );
}

function PsnCard({ account, token, onChange }: { account?: PlatformAccount; token: string; onChange: () => void }) {
  const [npsso, setNpsso] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (npsso.trim().length < 32) return;
    setBusy(true);
    try {
      await api.setPsnAccount(npsso.trim(), true, token);
      setNpsso("");
      onChange();
    } catch (err) {
      console.error("Save PSN error:", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface-container-low border border-outline-variant/20 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="font-semibold text-on-surface">PlayStation {account?.hasNpsso && <span className="text-xs text-on-surface/40 font-normal">· connected</span>}</span>
        <HealthChip account={account} />
      </div>
      {account?.lastError && <p className="text-xs text-red-400 mb-3">{account.lastError}</p>}
      <p className="text-xs text-on-surface/40 mb-3">
        Paste your NPSSO token from{" "}
        <a href="https://ca.account.sony.com/api/v1/ssocookie" target="_blank" rel="noreferrer" className="text-accent underline">ca.account.sony.com/api/v1/ssocookie</a>{" "}
        (log in first). Lasts ~2 months; re-paste when it shows "needs attention".
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={npsso}
          onChange={(e) => setNpsso(e.target.value)}
          placeholder="64-character NPSSO token"
          className="flex-1 min-w-[16rem] bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent"
        />
        <button
          onClick={save}
          disabled={busy || npsso.trim().length < 32}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save & sync"}
        </button>
      </div>
      {account?.lastSyncedAt && (
        <p className="text-xs text-on-surface/40 mt-3">Last synced {new Date(account.lastSyncedAt).toLocaleString()}</p>
      )}
    </div>
  );
}

function XboxCard({ account, token, onChange }: { account?: PlatformAccount; token: string; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      await api.setXboxAccount(true, token);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface-container-low border border-outline-variant/20 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="font-semibold text-on-surface">
          Xbox / Game Pass{" "}
          {account?.gamertag && <span className="text-xs text-on-surface/40 font-normal">· {account.gamertag}</span>}
        </span>
        <HealthChip account={account} />
      </div>
      {(error || account?.lastError) && <p className="text-xs text-red-400 mb-3">{error ?? account?.lastError}</p>}
      <p className="text-xs text-on-surface/40 mb-3">
        Requires <code>OPENXBL_API_KEY</code> in the server env (get one at{" "}
        <a href="https://xbl.io" target="_blank" rel="noreferrer" className="text-accent underline">xbl.io</a>),
        then restart the API. The key is tied to your own account — just connect.
      </p>
      <button
        onClick={connect}
        disabled={busy}
        className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
      >
        {busy ? "Connecting…" : account?.xuid ? "Reconnect & sync" : "Connect & sync"}
      </button>
      {account?.lastSyncedAt && (
        <p className="text-xs text-on-surface/40 mt-3">Last synced {new Date(account.lastSyncedAt).toLocaleString()}</p>
      )}
    </div>
  );
}

const IMPORT_SOURCES: ImportSource[] = ["steam", "psn", "xbox", "epic", "gog", "meta_quest"];

function ManualImportPanel({
  accounts,
  token,
  onChange,
  userPlatforms,
}: {
  accounts: PlatformAccount[];
  token: string;
  onChange: () => void;
  userPlatforms: UserPlatform[];
}) {
  const [source, setSource] = useState<string>("epic");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function handleSourceChange(next: string) {
    setSource(next);
    setText("");
    setMsg(null);
  }

  async function doImport() {
    if (!text.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.importLibrary(source as ImportSource, text, token);
      setMsg(`Importing ${res.count} titles in the background…`);
      setText("");
      onChange();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const isBuiltin = IMPORT_SOURCES.includes(source as ImportSource);
  const account = isBuiltin ? accounts.find((a) => a.platform === source) : undefined;

  return (
    <div className="bg-surface-container-low border border-outline-variant/20 p-5 max-w-2xl">
      <div className="flex items-center gap-3 mb-4">
        <select
          value={source}
          onChange={(e) => handleSourceChange(e.target.value)}
          className="bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent"
        >
          {[
            ...IMPORT_SOURCES.map((src) => ({ value: src, label: PLATFORM_LABELS[src as Platform] })),
            ...userPlatforms.map((up) => ({ value: String(up.id), label: up.name })),
          ].sort((a, b) => a.label.localeCompare(b.label)).map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        {account?.lastImportedAt && (
          <span className="text-xs text-on-surface/40">last import {new Date(account.lastImportedAt).toLocaleDateString()}</span>
        )}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={"Half-Life 2\nHollow Knight\nHades, 1145360"}
        className="w-full bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm font-mono focus:outline-none focus:border-accent resize-y"
      />
      <div className="flex items-center justify-between mt-3">
        {msg ? <p className="text-xs text-on-surface/50">{msg}</p> : <span />}
        <button
          onClick={doImport}
          disabled={busy || !text.trim()}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
    </div>
  );
}

function DupSide({ game }: { game: DuplicateCandidate["game1"] }) {
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      {game.coverPath && <img src={game.coverPath} alt="" className="w-10 h-12 object-cover" />}
      <div className="min-w-0">
        <p className="text-sm text-on-surface truncate">{game.title}</p>
        <p className="text-[11px] text-on-surface/40">{game.platform}</p>
      </div>
    </div>
  );
}
