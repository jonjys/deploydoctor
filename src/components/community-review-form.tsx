"use client";

import { useState, type FormEvent } from "react";
import { useLang } from "@/components/lang";

export function CommunityReviewForm() {
  const sv = useLang() === "sv";
  const [kind, setKind] = useState<"review" | "idea">("review");
  const [rating, setRating] = useState(0);
  const [name, setName] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        kind, name: form.get("name"), body: form.get("body"), website: form.get("website"),
        rating: kind === "review" ? rating : null, consent: kind === "review" && form.get("consent") === "on",
      }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || (sv ? "Kunde inte skicka." : "Could not send."));
      setSent(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : (sv ? "Försök igen." : "Please try again.")); }
    finally { setBusy(false); }
  }
  if (sent) return <div className="review-thanks" role="status"><h3>{sv ? "Tack, det betyder mycket." : "Thank you. This helps a lot."}</h3>
    <p>{kind === "review" ? (sv ? "Ditt omdöme är sparat och väntar på granskning. Det publiceras inte direkt." : "Your review is saved and waiting for moderation. It is not published immediately.") : (sv ? "Din idé är sparad som privat feedback till oss." : "Your idea is saved as private feedback for us.")}</p>
    <button className="link-button" type="button" onClick={() => setSent(false)}>{sv ? "Ändra min feedback" : "Edit my feedback"}</button></div>;
  return <form className="community-form" onSubmit={submit}>
    <fieldset disabled={busy}><legend>{sv ? "Gör DeployDoctor bättre" : "Help shape DeployDoctor"}</legend>
      <div className="review-kind"><label><input type="radio" name="kind" value="review" checked={kind === "review"} onChange={() => setKind("review")} />{sv ? "Lämna omdöme" : "Leave a review"}</label>
        <label><input type="radio" name="kind" value="idea" checked={kind === "idea"} onChange={() => setKind("idea")} />{sv ? "Föreslå förbättring (privat)" : "Suggest an improvement (private)"}</label></div>
      {kind === "review" && <fieldset className="rating-field"><legend>{sv ? "Ditt betyg" : "Your rating"}</legend><div className="rating-choices">{[1, 2, 3, 4, 5].map(value => <label key={value} className={value <= rating ? "is-selected" : ""}>
        <input type="radio" name="rating" required value={value} checked={rating === value} onChange={() => setRating(value)} aria-label={`${value} ${sv ? "av 5 stjärnor" : "out of 5 stars"}`} /><span aria-hidden="true">★</span>
      </label>)}</div></fieldset>}
      <label className="review-field">{sv ? "Namn eller alias" : "Name or alias"}<input name="name" required minLength={1} maxLength={60} autoComplete="nickname" value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="review-field">{kind === "review" ? (sv ? "Din upplevelse" : "Your experience") : (sv ? "Vad vill du förbättra?" : "What would you improve?")}<textarea name="body" required minLength={10} maxLength={1500} rows={4} value={bodyText} onChange={event => setBodyText(event.target.value)} /></label>
      <p className="review-policy">{sv ? "Skriv inga API-nycklar, loggar eller privata repouppgifter här." : "Please leave out API keys, logs and private repository details."}</p>
      <div className="review-trap" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      {kind === "review" && <label className="review-consent"><input type="checkbox" name="consent" required checked={consent} onChange={event => setConsent(event.target.checked)} />{sv ? "Mitt namn/alias, betyg och min text får visas offentligt här på sidan." : "My name/alias, rating and text may be displayed publicly on this page."}</label>}
      <p className="review-policy">{sv ? "En ny inskickning ersätter ditt tidigare omdöme eller förslag från samma webbläsare." : "Submitting again replaces your previous review or idea from this browser."}</p>
      <button className="cta-button" disabled={busy} type="submit">{busy ? (sv ? "Skickar…" : "Sending…") : (sv ? "Skicka feedback" : "Send feedback")}</button>
    </fieldset>{error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
