"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CopyTextButton } from "@/components/copy-text-button";
import { partnerMailto, partnerSlugQuery } from "@/lib/human-audit";

export type PartnerDeskLabels = {
  slug: string;
  slugHint: string;
  tracked: string;
  invalidSlug: string;
  copy: string;
  copied: string;
  signupTitle: string;
  signupLead: string;
  agency: string;
  email: string;
  website: string;
  submit: string;
  errorAgency: string;
  errorEmail: string;
  errorSlug: string;
};

export function PartnerDesk({ labels }: { labels: PartnerDeskLabels }) {
  const [slug, setSlug] = useState("");
  const [agency, setAgency] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");

  const tracked = useMemo(() => {
    const query = slug.trim() ? partnerSlugQuery(slug) : null;
    return query ? `?${query}` : null;
  }, [slug]);
  const slugTouched = slug.trim().length > 0;
  const mailto = useMemo(() => partnerMailto({ agency, email, website, slug }), [agency, email, website, slug]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mailto) {
      window.location.href = mailto;
      return;
    }
    if (!agency.trim()) setError(labels.errorAgency);
    else if (!email.trim() || !email.includes("@")) setError(labels.errorEmail);
    else setError(labels.errorSlug);
  }

  return (
    <>
      <form className="partner-form" onSubmit={submit} noValidate>
        <h2>{labels.signupTitle}</h2>
        <p>{labels.signupLead}</p>
        <label htmlFor="partner-agency">{labels.agency}
          <input id="partner-agency" name="agency" autoComplete="organization" required maxLength={120} value={agency} onChange={(event) => setAgency(event.target.value)} />
        </label>
        <label htmlFor="partner-email">{labels.email}
          <input id="partner-email" name="email" type="email" autoComplete="email" required maxLength={200} value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label htmlFor="partner-website">{labels.website}
          <input id="partner-website" name="website" type="url" autoComplete="url" maxLength={200} value={website} onChange={(event) => setWebsite(event.target.value)} />
        </label>
        <label htmlFor="partner-slug">{labels.slug}
          <input id="partner-slug" name="slug" required maxLength={64} spellCheck={false} autoCapitalize="none" autoCorrect="off" value={slug} onChange={(event) => setSlug(event.target.value)} aria-describedby="partner-slug-hint" />
        </label>
        <p id="partner-slug-hint" className="partner-hint">{labels.slugHint}</p>
        {slugTouched && !tracked && <p className="form-error" role="alert">{labels.invalidSlug}</p>}
        {tracked && (
          <div>
            <p>{labels.tracked}</p>
            <pre><code>{tracked}</code></pre>
            <p className="ci-copy"><CopyTextButton text={tracked} label={labels.copy} copiedLabel={labels.copied} compact /></p>
          </div>
        )}
        {error && !mailto && <p className="form-error" role="alert">{error}</p>}
        {mailto ? <a className="cta-button" href={mailto}>{labels.submit}</a> : <button className="cta-button" type="submit">{labels.submit}</button>}
      </form>
    </>
  );
}
