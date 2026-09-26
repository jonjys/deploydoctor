import { SiteNav } from "@/components/site-nav";
import { CheckoutConfirmation } from "@/components/checkout-confirmation";
export default async function Success({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id } = await searchParams;
  return <main className="site-shell"><SiteNav /><section className="checkout-card"><h1>Tack!</h1>
    {session_id ? <CheckoutConfirmation sessionId={session_id} /> : <p>Öppna länken från Stripe Checkout för att bekräfta köpet.</p>}
  </section></main>;
}
