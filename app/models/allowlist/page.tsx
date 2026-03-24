"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Search, X } from "lucide-react";

import { Spinner } from "@/components/loaders/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";

type AvailableModel = {
  key: string;
  label: string;
  variants: Array<string>;
};

type ModelAllowlistResponse = {
  config: {
    allowedModelKeys: Array<string>;
    defaultModelKey: string | null;
    defaultVariant: string | null;
  };
  providerDefaultModelKey: string | null;
  availableModels: Array<AvailableModel>;
  error?: string;
};

export default function ModelsAllowlistPage() {
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [providerDefaultModelKey, setProviderDefaultModelKey] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<AvailableModel>>([]);
  const [allowedModelKeys, setAllowedModelKeys] = useState<Array<string>>([]);
  const [defaultModelKey, setDefaultModelKey] = useState<string | null>(null);
  const [defaultVariant, setDefaultVariant] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  // Used to scroll back to the top to reveal success / error banners after save
  const pageTopRef = useRef<HTMLDivElement>(null);

  const defaultModelOptions = useMemo(() => {
    if (allowedModelKeys.length === 0) return availableModels;
    const allowedSet = new Set(allowedModelKeys);
    return availableModels.filter((model) => allowedSet.has(model.key));
  }, [allowedModelKeys, availableModels]);

  const defaultModelVariants = useMemo(
    () => availableModels.find((model) => model.key === defaultModelKey)?.variants ?? [],
    [availableModels, defaultModelKey]
  );

  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return availableModels;
    return availableModels.filter(
      (m) => m.label.toLowerCase().includes(q) || m.key.toLowerCase().includes(q)
    );
  }, [availableModels, modelSearch]);

  // Models actually shown in the list (filtered + optional selected-only view)
  const displayedModels = useMemo(() => {
    if (!showSelectedOnly) return filteredModels;
    const selectedSet = new Set(allowedModelKeys);
    return filteredModels.filter((m) => selectedSet.has(m.key));
  }, [filteredModels, showSelectedOnly, allowedModelKeys]);

  function applyResponse(payload: ModelAllowlistResponse) {
    setLoaded(true);
    setProviderDefaultModelKey(payload.providerDefaultModelKey);
    setAvailableModels(payload.availableModels);
    setAllowedModelKeys(payload.config.allowedModelKeys);
    setDefaultModelKey(payload.config.defaultModelKey);
    setDefaultVariant(payload.config.defaultVariant);
  }

  async function handleAccess(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setResultMessage("");

    if (!adminPassword) {
      setError("Admin password is required");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/models/allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword }),
      });
      const payload = (await response.json()) as ModelAllowlistResponse;
      if (!response.ok) {
        setError(payload.error ?? "Failed to load model settings");
        return;
      }
      applyResponse(payload);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function handleToggleAllowedModel(modelKey: string) {
    const next = allowedModelKeys.includes(modelKey)
      ? allowedModelKeys.filter((value) => value !== modelKey)
      : [...allowedModelKeys, modelKey];

    setAllowedModelKeys(next);

    if (next.length > 0 && defaultModelKey && !next.includes(defaultModelKey)) {
      setDefaultModelKey(null);
      setDefaultVariant(null);
    }
  }

  function handleClearSelectedModels() {
    setAllowedModelKeys([]);
    setShowSelectedOnly(false);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setResultMessage("");

    if (!adminPassword) {
      setError("Admin password is required");
      pageTopRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/models/allowlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword, allowedModelKeys, defaultModelKey, defaultVariant }),
      });
      const payload = (await response.json()) as ModelAllowlistResponse;
      if (!response.ok) {
        setError(payload.error ?? "Failed to save model settings");
        pageTopRef.current?.scrollIntoView({ behavior: "smooth" });
        return;
      }

      applyResponse(payload);
      setResultMessage("Model settings saved successfully.");
    } catch {
      setError("Something went wrong");
    } finally {
      setSaving(false);
      pageTopRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }

  return (
    <div className="auth-page flex min-h-dvh">
      <div className="w-full px-6 py-10 md:px-16 lg:px-24">

        {/* Top anchor for scroll-to-top */}
        <div ref={pageTopRef} />

        <Link
          href="/agent"
          className="heading-serif text-sm tracking-widest text-(--ink-soft) transition-colors hover:text-foreground"
        >
          LNP Agent
        </Link>

        <div className="mx-auto mt-10 w-full max-w-2xl">
          <h1 className="heading-serif text-2xl">Model Allowlist</h1>
          <p className="mt-2 text-sm text-(--ink-muted)">
            Choose which OpenRouter models are available in new chats and optionally enforce a
            backend default model and variant.
          </p>

          {/* ── Error / success banners ───────────────────────────── */}
          {error ? (
            <div className="mt-5 border-2 border-(--danger) bg-(--danger-soft) px-4 py-3 text-sm text-(--danger)">
              {error}
            </div>
          ) : null}

          {resultMessage ? (
            <div className="mt-5 border-2 border-(--brand) bg-(--brand-soft) px-4 py-3 text-sm font-semibold text-(--brand)">
              {resultMessage}
            </div>
          ) : null}

          {/* ── Password gate ─────────────────────────────────────── */}
          {!loaded ? (
            <form onSubmit={handleAccess} autoComplete="off" className="mt-8 flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="admin-password"
                  className="text-xs font-semibold uppercase tracking-wider text-(--ink-soft)"
                >
                  Admin Password
                </Label>
                <input
                  id="admin-password"
                  name="admin-access-code"
                  type="text"
                  inputMode="text"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  style={{ WebkitTextSecurity: "disc" }}
                  className="app-field h-10 w-full border-2 px-3 text-sm outline-none"
                />
              </div>

              <button type="submit" disabled={loading} className="app-btn-primary mt-2 h-10 w-full text-sm">
                {loading ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Spinner size="sm" className="text-(--brand-on)" />
                    <span>Loading model settings…</span>
                  </span>
                ) : (
                  "Access model settings"
                )}
              </button>
            </form>

          ) : (
            <form onSubmit={handleSave} autoComplete="off" className="mt-8 flex flex-col gap-8">

              {/* ── Section: current defaults ──────────────────────── */}
              <section className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-(--ink-soft)">
                  Current Defaults
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="border-2 border-(--border) bg-(--surface) px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                      OpenCode Default
                    </p>
                    <p className="mt-1.5 truncate text-sm text-(--ink)">
                      {providerDefaultModelKey ?? "—"}
                    </p>
                  </div>
                  <div className="border-2 border-(--border) bg-(--surface) px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                      Effective Backend Default
                    </p>
                    <p className="mt-1.5 truncate text-sm text-(--ink)">
                      {defaultModelKey ?? providerDefaultModelKey ?? "OpenCode default"}
                    </p>
                    <p className="mt-0.5 text-xs text-(--ink-soft)">
                      Variant: {defaultVariant ?? "default"}
                    </p>
                  </div>
                </div>
              </section>

              {/* ── Section: allowed models ────────────────────────── */}
              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-(--ink-soft)">
                    Allowed Models
                  </p>
                  <span className="shrink-0 text-xs text-(--ink-muted)">
                    {allowedModelKeys.length === 0
                      ? "All models allowed"
                      : `${allowedModelKeys.length} of ${availableModels.length} selected`}
                  </span>
                </div>
                <p className="text-xs text-(--ink-muted)">
                  Leave this empty to allow all current OpenRouter models in new chats.
                </p>

                {/* Search + show-selected toggle */}
                <div className="flex flex-wrap gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-(--ink-soft)" />
                    <input
                      type="text"
                      name="model-filter"
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      placeholder={`Search ${availableModels.length} models…`}
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      data-lpignore="true"
                      data-1p-ignore="true"
                      className="app-field h-10 w-full border-2 pl-9 pr-9 text-sm outline-none"
                    />
                    {modelSearch ? (
                      <button
                        type="button"
                        onClick={() => setModelSearch("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-(--ink-soft) hover:text-foreground"
                        aria-label="Clear search"
                      >
                        <X className="size-4" />
                      </button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSelectedOnly((v) => !v)}
                    className={`inline-flex h-10 shrink-0 items-center gap-2 border-2 px-3 text-xs font-semibold uppercase tracking-[0.07em] transition-colors ${
                      showSelectedOnly
                        ? "border-(--ink-soft) bg-(--paper-3) text-foreground"
                        : "border-(--border) text-(--ink-soft) hover:border-(--ink-soft) hover:text-foreground"
                    }`}
                    aria-pressed={showSelectedOnly}
                  >
                    <span>{showSelectedOnly ? "Showing selected" : "Show selected"}</span>
                    <span className="border border-current/30 px-1.5 py-0.5 text-[10px] leading-none">
                      {allowedModelKeys.length}
                    </span>
                  </button>
                  {allowedModelKeys.length > 0 ? (
                    <button
                      type="button"
                      onClick={handleClearSelectedModels}
                      className="h-10 shrink-0 border-2 border-(--border) px-3 text-xs font-semibold uppercase tracking-[0.07em] text-(--ink-soft) transition-colors hover:border-(--danger) hover:text-(--danger)"
                    >
                      Clear selected
                    </button>
                  ) : null}
                </div>

                {/* Table */}
                <div className="agent-dialog border-2 border-(--border)">
                  {/* Column header */}
                  <div className="flex items-center border-b-2 border-(--border) bg-(--paper-3) px-4 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.07em] text-(--ink-muted)">
                    <span>Model</span>
                    <span className="ml-auto">Variants</span>
                  </div>

                  <ScrollArea className="h-64 [&>[data-slot=scroll-area-viewport]>div]:block! [&>[data-slot=scroll-area-viewport]>div]:w-full">
                    {displayedModels.length === 0 ? (
                      <div className="flex h-20 items-center justify-center">
                        <p className="text-sm text-(--ink-muted)">
                          {showSelectedOnly
                            ? "No models selected yet."
                            : `No models match "${modelSearch}"`}
                        </p>
                      </div>
                    ) : (
                      displayedModels.map((model) => {
                        const checked = allowedModelKeys.includes(model.key);
                        return (
                          <button
                            key={model.key}
                            type="button"
                            role="checkbox"
                            aria-checked={checked}
                            onClick={() => handleToggleAllowedModel(model.key)}
                            className={`group flex w-full items-center gap-3 border-b border-(--border)/40 px-4 py-2.5 text-left last:border-b-0 transition-colors ${
                              checked ? "bg-(--brand-soft)" : "hover:bg-(--surface-hover)"
                            }`}
                          >
                            <div
                              className={`flex size-4 shrink-0 items-center justify-center border-2 transition-colors ${
                                checked
                                  ? "border-(--brand) bg-(--brand)"
                                  : "border-(--border) group-hover:border-(--ink-soft)"
                              }`}
                            >
                              {checked && (
                                <Check className="size-2.5 text-(--brand-on)" strokeWidth={3} />
                              )}
                            </div>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-(--ink)">
                                {model.label}
                              </span>
                              <span className="block truncate text-[11px] text-(--ink-muted)">
                                {model.key}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-(--ink-soft)">
                              {model.variants.length > 0 ? model.variants.length : "—"}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </ScrollArea>
                </div>
              </section>

              {/* ── Section: enforce defaults ──────────────────────── */}
              <section className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-(--ink-soft)">
                  Enforced Defaults
                </p>
                <p className="text-xs text-(--ink-muted)">
                  Optionally force all new chats to use a specific model and variant.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label
                      htmlFor="default-model"
                      className="text-xs font-semibold uppercase tracking-wider text-(--ink-soft)"
                    >
                      Default Model
                    </Label>
                    <select
                      id="default-model"
                      value={defaultModelKey ?? ""}
                      onChange={(event) => {
                        const nextDefaultModelKey = event.target.value || null;
                        setDefaultModelKey(nextDefaultModelKey);
                        setDefaultVariant(null);
                      }}
                      className="app-field h-10 w-full border-2 px-3 text-sm outline-none"
                    >
                      <option value="">Use OpenCode default</option>
                      {defaultModelOptions.map((model) => (
                        <option key={model.key} value={model.key}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label
                      htmlFor="default-variant"
                      className="text-xs font-semibold uppercase tracking-wider text-(--ink-soft)"
                    >
                      Default Variant
                    </Label>
                    <select
                      id="default-variant"
                      value={defaultVariant ?? ""}
                      onChange={(event) => setDefaultVariant(event.target.value || null)}
                      disabled={!defaultModelKey}
                      className="app-field h-10 w-full border-2 px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">Default</option>
                      {defaultModelVariants.map((variant) => (
                        <option key={variant} value={variant}>
                          {variant}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              {/* ── Section: save ──────────────────────────────────── */}
              <section className="flex flex-col gap-3 border-t-2 border-(--border) pt-6">
                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor="persist-admin-password"
                    className="text-xs font-semibold uppercase tracking-wider text-(--ink-soft)"
                  >
                    Confirm Admin Password
                  </Label>
                  <input
                    id="persist-admin-password"
                    name="confirm-admin-access-code"
                    type="text"
                    inputMode="text"
                    value={adminPassword}
                    onChange={(event) => setAdminPassword(event.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    style={{ WebkitTextSecurity: "disc" }}
                    className="app-field h-10 w-full border-2 px-3 text-sm outline-none"
                  />
                </div>

                <button type="submit" disabled={saving} className="app-btn-primary h-10 w-full text-sm">
                  {saving ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <Spinner size="sm" className="text-(--brand-on)" />
                      <span>Saving model settings…</span>
                    </span>
                  ) : (
                    "Save model settings"
                  )}
                </button>
              </section>

            </form>
          )}
        </div>
      </div>
    </div>
  );
}
