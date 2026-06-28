"use client";
import React, { useEffect, useRef, useState } from "react";
import { PlatformIcon } from "./render";

interface Props {
  value: string;
  onChange: (value: string) => void;
  svgPreview?: React.ReactNode;
}

export function IconPicker({ value, onChange, svgPreview }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setDraft(value); }, [value]);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function apply() {
    onChange(draft.trim());
    setOpen(false);
  }

  function clear() {
    onChange("");
    setDraft("");
    setOpen(false);
  }

  const isUrl = value.startsWith("http://") || value.startsWith("https://");
  const draftIsUrl = draft.startsWith("http://") || draft.startsWith("https://");

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-10 h-9 flex items-center justify-center rounded-lg border transition-colors ${
          open ? "border-accent bg-surface-container" : "border-outline-variant/40 bg-surface-container hover:border-outline-variant/70"
        }`}
        title="Set icon"
      >
        {value ? (
          <PlatformIcon value={value} fallback={svgPreview} size={20} />
        ) : (
          <span className="text-on-surface/30">{svgPreview ?? <span className="material-symbols-outlined text-base">image</span>}</span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-72 bg-surface-container-high border border-outline-variant/30 rounded-2xl shadow-xl p-3 flex flex-col gap-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40">Image URL</p>

          {draftIsUrl && (
            <div className="flex justify-center">
              <img src={draft} alt="" className="h-12 w-12 object-contain rounded" />
            </div>
          )}

          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") apply(); if (e.key === "Escape") setOpen(false); }}
            placeholder="https://example.com/icon.png"
            className="w-full bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-xs focus:outline-none focus:border-accent"
            autoFocus
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={apply}
              disabled={!draft.trim()}
              className="flex-1 py-1.5 rounded-lg bg-accent text-white text-xs font-bold disabled:opacity-40 hover:bg-accent/80 transition-colors"
            >
              Apply
            </button>
            {value && (
              <button
                type="button"
                onClick={clear}
                className="px-3 py-1.5 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface/50 text-xs hover:text-red-400 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
