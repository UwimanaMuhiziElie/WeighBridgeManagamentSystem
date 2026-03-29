import React, { useEffect, useMemo, useState } from "react";
import { apiClient } from "@weighbridge/shared";

const DEFAULT_HINT = "http://178.128.226.90:3001";

// localStorage keys used by apiClient.ts
const BASE_URL_KEY = "api_base_url";
const BASE_URL_USER_SET_KEY = "api_base_url_user_set";

function safeStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {}
  return null;
}

function isProdBuild(): boolean {
  try {
    const env = (import.meta as any)?.env;
    if (typeof env?.PROD === "boolean") return env.PROD;
    return String(env?.MODE || "").toLowerCase() === "production";
  } catch {
    return false;
  }
}

function normalizeUrlInput(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  // If user typed "178.128.226.90:3001" or "weighbridge.ezwm.ca", add protocol
  if (!/^https?:\/\//i.test(s)) return `http://${s}`;
  return s;
}

function isLoopback(url: string): boolean {
  try {
    const u = new URL(url);
    const h = (u.hostname || "").toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    return false;
  }
}

export default function ApiServerSettings() {
  const storage = useMemo(() => safeStorage(), []);
  const [url, setUrl] = useState<string>("");
  const [effective, setEffective] = useState<string>("");

  useEffect(() => {
    const stored = storage?.getItem(BASE_URL_KEY) || "";
    const storedNorm = stored.trim();

    // Effective base URL (what the app will actually use)
    const eff = apiClient.getBaseUrl();
    setEffective(eff);

    //Permanent safety:
    // In production builds, if a stale localhost override exists, clear it automatically
    if (isProdBuild() && storedNorm && isLoopback(storedNorm)) {
      try {
        storage?.removeItem(BASE_URL_KEY);
        storage?.removeItem(BASE_URL_USER_SET_KEY);
      } catch {}
      // refresh effective after clearing
      const eff2 = apiClient.getBaseUrl();
      setEffective(eff2);
      setUrl(eff2);
      return;
    }

    // Show stored override if present; otherwise show effective
    setUrl(storedNorm || eff);
  }, [storage]);

  const save = () => {
    const trimmed = (url || "").trim();

    // Blank = reset to default/auto
    if (!trimmed) {
      apiClient.setBaseUrl(null);
      const eff = apiClient.getBaseUrl();
      setEffective(eff);
      setUrl(eff);
      alert("Reset API URL to default.");
      return;
    }

    const normalized = normalizeUrlInput(trimmed);

    // Validate URL
    try {
      // eslint-disable-next-line no-new
      new URL(normalized);
    } catch {
      alert("Invalid URL. Example: http://178.128.226.90:3001");
      return;
    }

    apiClient.setBaseUrl(normalized);

    // (Extra safety) Ensure flag is set even if apiClient changes later
    try {
      storage?.setItem(BASE_URL_USER_SET_KEY, "true");
      storage?.setItem(BASE_URL_KEY, normalized);
    } catch {}

    const eff = apiClient.getBaseUrl();
    setEffective(eff);
    setUrl(normalized);

    alert(`Saved API URL: ${normalized}`);
  };

  const reset = () => {
    apiClient.setBaseUrl(null);
    try {
      storage?.removeItem(BASE_URL_KEY);
      storage?.removeItem(BASE_URL_USER_SET_KEY);
    } catch {}

    const eff = apiClient.getBaseUrl();
    setEffective(eff);
    setUrl(eff);

    alert("Reset API URL to default.");
  };

  const useSuggested = () => {
    setUrl(DEFAULT_HINT);
  };

  return (
    <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
      <h3 style={{ margin: "0 0 8px 0" }}>Server URL</h3>

      <p style={{ margin: "0 0 8px 0", color: "#6b7280" }}>
        This controls which backend API the desktop app calls.
        <br />
        Suggested: <b>{DEFAULT_HINT}</b>
      </p>

      <div style={{ margin: "0 0 10px 0", color: "#111827", fontSize: 12 }}>
        <b>Currently effective:</b> <span style={{ fontFamily: "monospace" }}>{effective || "—"}</span>
      </div>

      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={DEFAULT_HINT}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid #d1d5db",
          marginBottom: 10,
          fontFamily: "monospace",
        }}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={save} style={{ padding: "10px 12px", borderRadius: 10 }}>
          Save
        </button>

        <button onClick={reset} style={{ padding: "10px 12px", borderRadius: 10 }}>
          Reset
        </button>

        <button onClick={useSuggested} style={{ padding: "10px 12px", borderRadius: 10 }}>
          Use suggested
        </button>
      </div>

      <div style={{ marginTop: 10, color: "#6b7280", fontSize: 12 }}>
        In production builds, localhost overrides are auto-cleared to avoid “Failed to fetch”.
      </div>
    </div>
  );
}