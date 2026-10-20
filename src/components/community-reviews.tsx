import { communitySummary } from "@/lib/community-store";
import { getLang } from "@/lib/lang";
import { CommunityReviewForm } from "@/components/community-review-form";

export async function CommunityReviews() {
  const [summary, lang] = await Promise.all([communitySummary(), getLang()]);
  const sv = lang === "sv";
  return <section className="community-panel" id="reviews" aria-labelledby="reviews-title">
    <div className="community-heading">
      <div><p className="section-kicker">{sv ? "Byggt med din feedback" : "Built with your feedback"}</p>
        <h2 id="reviews-title">{sv ? "Hur funkade DeployDoctor för dig?" : "How did DeployDoctor work for you?"}</h2>
        <p>{sv ? "Berätta vad som hjälpte, vad vi missade eller vad du vill ha härnäst." : "Tell us what helped, what we missed, or what you want next."}</p></div>
      {summary && summary.count > 0 && summary.average !== null ? <div className="review-score">
        <strong>{summary.average.toLocaleString(sv ? "sv-SE" : "en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}<small> / 5</small></strong>
        <span className="review-stars" aria-hidden="true">{"★".repeat(Math.round(summary.average))}{"☆".repeat(5 - Math.round(summary.average))}</span>
        <span>{summary.count} {sv ? "publicerade omdömen" : "published reviews"}</span>
      </div> : <p className="review-empty">{summary ? (sv ? "Inga publicerade omdömen ännu. Ditt kan bli det första." : "No published reviews yet. Yours could be the first.") : (sv ? "Omdömen kan inte hämtas just nu." : "Reviews are unavailable right now.")}</p>}
    </div>
    {summary && summary.reviews.length > 0 && <div className="review-grid">{summary.reviews.map(review => <article className="review-card" key={review.id}>
      <span className="review-stars" aria-label={`${review.rating} ${sv ? "av 5 stjärnor" : "out of 5 stars"}`}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span>
      <p className="review-body">{review.body}</p><footer><strong>{review.name}</strong><time dateTime={review.created_at}>{new Date(review.created_at).toLocaleDateString(sv ? "sv-SE" : "en-US", { year: "numeric", month: "short", day: "numeric" })}</time></footer>
    </article>)}</div>}
    <p className="review-policy">{sv ? "Besökaromdömen, inte verifierade köp. Vi granskar för spam och personuppgifter före publicering, oavsett betyg. Snittet gäller alla publicerade omdömen." : "Visitor reviews, not verified purchases. We check for spam and personal data before publishing, regardless of rating. The average includes all published reviews."}</p>
    <CommunityReviewForm />
  </section>;
}
