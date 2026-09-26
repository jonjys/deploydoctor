"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LANG_COOKIE, LANGS, t, type Lang, type MessageKey, type Vars } from "@/lib/i18n";

const LangContext = createContext<Lang>("en");

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext value={lang}>{children}</LangContext>;
}

export function useLang() {
  return useContext(LangContext);
}

export function useT() {
  const lang = useLang();
  return useCallback((key: MessageKey, vars?: Vars) => t(lang, key, vars), [lang]);
}

function storeLang(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
}

export function LangSwitch() {
  const lang = useLang();
  const router = useRouter();
  const translate = useT();

  function choose(next: Lang) {
    if (next === lang) return;
    storeLang(next);
    router.refresh();
  }

  return (
    <div className="lang-switch" role="group" aria-label={translate("lang.aria")}>
      {LANGS.map((code) => (
        <button key={code} type="button" lang={code} aria-pressed={code === lang} onClick={() => choose(code)}>
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
