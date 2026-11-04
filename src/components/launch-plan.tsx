import { CopyTextButton } from "@/components/copy-text-button";
import { ScanCheckoutButton } from "@/components/scan-checkout-button";
import type { LaunchPlan } from "@/lib/launch-plan";
import type { Lang } from "@/lib/i18n";
import { planPrice } from "@/lib/plans";

/**
 * The launch plan on a report. Without a pass the first section is open and the rest are titles only: the locked
 * steps, the AI prompt and the checklist are never rendered into the page, so they cannot be read from the HTML.
 */
export function LaunchPlanSection({ plan, unlocked, lang, reportId, repoUrl }: { plan: LaunchPlan; unlocked: boolean; lang: Lang; reportId: string; repoUrl: string }) {
  const sv = lang === "sv";
  const [first, ...rest] = plan.sections;
  const steps = (section: LaunchPlan["sections"][number]) => (
    <ol className="plan-steps">{section.steps.map((step, index) => (
      <li key={index} className={step.done ? "is-done" : undefined}>
        <strong>{step.title}</strong>
        <p>{step.detail}</p>
        {step.code && <pre><code>{step.code}</code></pre>}
      </li>
    ))}</ol>
  );
  return (
    <section className="launch-plan" id="launch-plan" aria-labelledby="launch-plan-heading">
      <p className="section-kicker">{sv ? "DIN LANSERINGSPLAN" : "YOUR LAUNCH PLAN"}</p>
      <h2 id="launch-plan-heading">{sv ? `${plan.stepCount} steg från det här repot till din första betalande kund` : `${plan.stepCount} steps from this repo to your first paying customer`}</h2>
      <p className="plan-sub">{sv
        ? "Byggd från din kod: rätt miljövariabler, betalning, data, inloggning, juridik, övervakning och lanseringsdagen. På engelska, redo att följa."
        : "Built from your code: the exact environment variables, payments, data, sign-in, legal pages, monitoring and launch day. In order, ready to follow."}</p>

      <div className="plan-section is-open">
        <h3>1. {first.title}</h3>
        <p className="plan-why">{first.why}</p>
        {steps(first)}
      </div>

      {unlocked ? (
        <>
          {rest.map((section, index) => (
            <div className="plan-section is-open" key={section.id}>
              <h3>{index + 2}. {section.title}</h3>
              <p className="plan-why">{section.why}</p>
              {steps(section)}
            </div>
          ))}
          <div className="plan-tools">
            <div>
              <strong>{sv ? "En prompt som gör kodjobbet" : "One prompt that does the code work"}</strong>
              <p>{sv ? "Klistra in i Cursor, Claude Code, Lovable eller v0. Den rör inga hemligheter och listar det du måste göra i dashboards." : "Paste it into Cursor, Claude Code, Lovable or v0. It never touches secrets and lists what you still do in dashboards."}</p>
            </div>
            <div className="action-buttons">
              <CopyTextButton text={plan.prompt} label={sv ? "Kopiera AI-prompten" : "Copy the AI prompt"} copiedLabel={sv ? "Kopierat" : "Copied"} />
              <a className="cta-button" download={`launch-plan-${plan.repo.replace(/[^\w.-]+/g, "-")}.md`} href={`data:text/markdown;charset=utf-8,${encodeURIComponent(plan.markdown)}`}>{sv ? "Ladda ner checklistan" : "Download the checklist"} ↓</a>
            </div>
          </div>
        </>
      ) : (
        <>
          <ol className="plan-locked" aria-label={sv ? "Låsta delar av planen" : "Locked parts of the plan"}>
            {rest.map((section, index) => (
              <li key={section.id}><span aria-hidden="true">🔒</span><div><strong>{index + 2}. {section.title}</strong><p>{section.why} <em>{section.steps.length} {sv ? "steg" : section.steps.length === 1 ? "step" : "steps"}</em></p></div></li>
            ))}
          </ol>
          <div className="plan-unlock">
            <div>
              <strong>{sv ? "Lås upp hela planen, AI-prompten och checklistan" : "Unlock the whole plan, the AI prompt and the checklist"}</strong>
              <p>{sv ? "Ingår i 24-timmarspasset: obegränsade skanningar, privata repon och lanseringsplanen för alla dina repon. Engångsbetalning, inget förnyas. Ladda om den här sidan när du har betalat." : "Included in the 24-hour pass: unlimited scans, private repos and the launch plan for every repo you scan. One-time payment, nothing renews. Reload this page after paying."}</p>
            </div>
            <ScanCheckoutButton plan="day" reportId={reportId} context={repoUrl}>{sv ? "Få planen" : "Get the plan"} · {planPrice("day", sv ? "sv" : "en")} →</ScanCheckoutButton>
          </div>
        </>
      )}
    </section>
  );
}
