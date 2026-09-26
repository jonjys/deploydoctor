import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, parseLang, t, type Lang, type MessageKey, type Vars } from "@/lib/i18n";

export async function getLang(): Promise<Lang> {
  return parseLang((await cookies()).get(LANG_COOKIE)?.value);
}

/** Server-side translator bound to the visitor's language. */
export async function getT() {
  const lang = await getLang();
  return { lang, t: (key: MessageKey, vars?: Vars) => t(lang, key, vars) };
}
