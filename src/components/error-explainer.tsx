"use client";

import { useState } from "react";
import { explainError, MAX_INPUT, type Explanation } from "@/lib/error-explainer";

export function ErrorExplainer() {
  const [input, setInput] = useState("");
  const [results, setResults] = useState<Explanation[] | null>(null);

  return (
    <section className="checks-panel" aria-label="Explain an error">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setResults(explainError(input));
        }}
      >
        <label htmlFor="error-input"><strong>Paste the error message or the end of your build log</strong></label>
        <textarea
          id="error-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          maxLength={MAX_INPUT}
          rows={10}
          spellCheck={false}
          placeholder={"Module not found: Can't resolve '@/components/Header'"}
          style={{ width: "100%", fontFamily: "monospace", marginTop: 8 }}
        />
        <p><small>Runs in your browser. Nothing is sent or stored. Remove secrets before pasting anyway.</small></p>
        <button type="submit" className="primary-button" disabled={!input.trim()}>Explain error</button>
      </form>

      {results && (
        <div aria-live="polite" style={{ marginTop: 24 }}>
          {results.length === 0 ? (
            <p>No known pattern matched. Paste the first block that contains the word Error, not only the last line of the log.</p>
          ) : (
            results.map(({ rule, line, excerpt }, i) => (
              <article key={rule.id} style={{ marginBottom: 24 }}>
                <p className="section-kicker">{i === 0 ? "MOST LIKELY CAUSE" : "ALSO MATCHED"}</p>
                <h2>{rule.title}</h2>
                {line > 0 && <p><small>Line {line}: <code>{excerpt}</code></small></p>}
                <p>{rule.cause}</p>
                <ol>{rule.fix.map((step) => <li key={step}>{step}</li>)}</ol>
                {rule.docs && <p><a href={rule.docs} target="_blank" rel="noopener noreferrer">Official documentation</a></p>}
              </article>
            ))
          )}
          <p><small>This is pattern matching, not a verified root cause.</small></p>
        </div>
      )}
    </section>
  );
}
