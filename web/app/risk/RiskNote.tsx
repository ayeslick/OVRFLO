import { RISK_SECTIONS } from "./riskCopy";
import "@/components/first-run/first-run.css";

export function RiskNote() {
  return (
    <article className="risk-note" data-control="UI-FIRST-RUN-RISK">
      <p className="first-run-kicker">RISK</p>
      {RISK_SECTIONS.map((section) => (
        <section key={section.id} className="risk-section" data-section={section.id}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.documents ? (
            <ul className="risk-docs">
              {section.documents.map((document) => (
                <li key={document.href}>
                  <a href={document.href} rel="noopener noreferrer" target="_blank">
                    {document.label}
                  </a>
                  <span>document — not a guarantee</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </article>
  );
}
