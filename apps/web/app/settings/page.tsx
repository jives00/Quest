"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
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
              <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 p-5">
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
            <ManualImportPanel accounts={accounts} token={token} onChange={reload} />
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

function PlatformsPanel({ token }: { token: string }) {
  const [platforms, setPlatforms] = useState<UserPlatform[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    api.getUserPlatforms(token).then(setPlatforms).catch(() => {});
  }, [token]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setMsg(null);
    try {
      const p = await api.addUserPlatform(name, token);
      setPlatforms((prev) => [...prev, { ...p, sortOrder: 0, createdAt: new Date().toISOString() }]);
      setNewName("");
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to add platform", ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    try {
      await api.deleteUserPlatform(id, token);
      setPlatforms((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to remove platform", ok: false });
    }
  }

  return (
    <div className="px-8 py-8">
      <h1 className="text-2xl font-black tracking-tight text-on-surface mb-1">Platforms</h1>
      <p className="text-sm text-on-surface/50 mb-8">
        Define every platform you own games on. Built-in platforms are managed automatically via{" "}
        <span className="text-on-surface/70">Integrations</span> or{" "}
        <span className="text-on-surface/70">Library Imports</span>. Custom platforms are{" "}
        <span className="text-on-surface/70">manually maintained</span> — no automatic syncing.
      </p>

      <div className="flex flex-col gap-6 max-w-xl">
        {/* Built-ins */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-3">Built-in</p>
          <div className="flex flex-col gap-2">
            {BUILTIN_PLATFORMS.map((p) => (
              <div
                key={p.slug}
                className="flex items-center justify-between px-4 py-3 rounded-xl bg-surface-container-low border border-outline-variant/20"
              >
                <span className="text-sm font-medium text-on-surface">{p.label}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 border border-outline-variant/30 px-2 py-0.5 rounded">
                  {p.integration}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Custom */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-3">Custom</p>
          {platforms.length === 0 ? (
            <p className="text-sm text-on-surface/30 mb-3">No custom platforms yet.</p>
          ) : (
            <div className="flex flex-col gap-2 mb-3">
              {platforms.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between px-4 py-3 rounded-xl bg-surface-container-low border border-outline-variant/20"
                >
                  <span className="text-sm font-medium text-on-surface">{p.name}</span>
                  <button
                    onClick={() => remove(p.id)}
                    className="text-on-surface/30 hover:text-red-400 transition-colors"
                    title="Remove platform"
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={add} className="flex gap-2">
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
              {busy ? "Adding…" : "Add platform"}
            </button>
          </form>
          {msg && <p className={`text-xs mt-2 ${msg.ok ? "text-accent" : "text-red-400"}`}>{msg.text}</p>}
        </div>
      </div>
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

        <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 p-5">
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

        <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 p-5">
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
      <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 p-6 max-w-md">
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
    <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 p-4">
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
    <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 p-4">
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
          {picked.coverPath && <img src={picked.coverPath} alt="" className="w-8 h-10 object-cover rounded shrink-0" />}
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
                  {g.coverPath && <img src={g.coverPath} alt="" className="w-7 h-9 object-cover rounded shrink-0" />}
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
    <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 p-5">
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
    <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 p-5">
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
    <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 p-5">
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
}: {
  accounts: PlatformAccount[];
  token: string;
  onChange: () => void;
}) {
  const [source, setSource] = useState<ImportSource>("epic");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function handleSourceChange(next: ImportSource) {
    setSource(next);
    setText("");
    setMsg(null);
  }

  async function doImport() {
    if (!text.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.importLibrary(source, text, token);
      setMsg(`Importing ${res.count} titles in the background…`);
      setText("");
      onChange();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const account = accounts.find((a) => a.platform === source);

  return (
    <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 p-5 max-w-2xl">
      <div className="flex items-center gap-3 mb-4">
        <select
          value={source}
          onChange={(e) => handleSourceChange(e.target.value as ImportSource)}
          className="bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent"
        >
          {IMPORT_SOURCES.map((src) => (
            <option key={src} value={src}>{PLATFORM_LABELS[src as Platform]}</option>
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
