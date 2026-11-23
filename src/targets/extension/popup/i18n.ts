import enMessages from "../_locales/en/messages.json" with { type: "json" };
import type { WebExtApi } from "../webext-api.ts";

interface LocaleEntry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

const englishCatalog = enMessages as Record<string, LocaleEntry>;

function formatFallback(entry: LocaleEntry, substitutions?: string | string[]): string {
  const values = Array.isArray(substitutions)
    ? substitutions
    : substitutions !== undefined
      ? [substitutions]
      : [];
  let text = entry.message;
  if (entry.placeholders) {
    for (const [placeholderName, spec] of Object.entries(entry.placeholders)) {
      const idxMatch = spec.content.match(/^\$(\d+)$/);
      const value = idxMatch ? (values[Number(idxMatch[1]) - 1] ?? "") : spec.content;
      text = text.replaceAll(`$${placeholderName.toUpperCase()}$`, value);
    }
  }
  for (let i = 0; i < values.length; i += 1) {
    text = text.replaceAll(`$${i + 1}`, values[i]!);
  }
  return text;
}

export interface PopupTranslator {
  locale: string;
  t(key: string, substitutions?: string | string[]): string;
}

export function createPopupTranslator(api?: Pick<WebExtApi, "i18n">): PopupTranslator {
  const uiLocale = api?.i18n?.getUILanguage?.() || "en";
  return {
    locale: uiLocale,
    t(key: string, substitutions?: string | string[]) {
      const resolved = api?.i18n?.getMessage(key, substitutions);
      if (resolved) return resolved;
      const entry = englishCatalog[key];
      return entry ? formatFallback(entry, substitutions) : key;
    },
  };
}
