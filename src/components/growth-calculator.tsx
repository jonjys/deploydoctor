"use client";

import { useState } from "react";

function usd(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
}

export function GrowthCalculator({ observedVisitors }: { observedVisitors: number | null }) {
  const [visitors, setVisitors] = useState(Math.max(0, observedVisitors ?? 150));
  const [rate, setRate] = useState(2);
  const [price, setPrice] = useState(2);
  const purchases = visitors * rate / 100;
  const amount = purchases * price;
  return <section className="growth-card growth-calculator" aria-labelledby="growth-forecast-heading">
    <p className="section-kicker">WHAT-IF CALCULATOR</p>
    <h2 id="growth-forecast-heading">Revenue simulator</h2>
    <p>Adjust assumptions to estimate monthly gross sales. The result is a scenario, not recorded revenue or a forecast guarantee.</p>
    <div className="growth-sliders">
      <label>Monthly visitors <strong>{visitors.toLocaleString("en-US")}</strong>
        <input type="range" min="0" max="10000" step="50" value={visitors} onChange={(e) => setVisitors(Number(e.target.value))} />
      </label>
      <label>Visitor-to-purchase rate <strong>{rate.toFixed(1)}%</strong>
        <input type="range" min="0" max="10" step="0.5" value={rate} onChange={(e) => setRate(Number(e.target.value))} />
      </label>
      <label>Average purchase value <strong>{usd(price)}</strong>
        <input type="range" min="2" max="50" step="1" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
      </label>
    </div>
    <div className="growth-projection">
      <div><span>Estimated purchases/month</span><strong>{purchases.toLocaleString("en-US", { maximumFractionDigits: 1 })}</strong></div>
      <div><span>Illustrative gross sales/month</span><strong>{usd(amount)}</strong></div>
    </div>
    <p className="growth-note">Assumes a fixed conversion rate and average order value. Before refunds, payment fees, taxes or subscription renewals. Changing visitor volume does not establish causation.</p>
  </section>;
}
