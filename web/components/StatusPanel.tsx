interface Props {
  title: string;
  description: string;
  details?: string[];
}

export function StatusPanel({ title, description, details = [] }: Props) {
  return (
    <div className="nb-status nb-status-error">
      <p className="nb-kicker text-[#8e2340]">System notice</p>
      <h3 className="mt-2 text-lg text-[var(--color-ink)]">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--color-ink)]/80">{description}</p>
      {details.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--color-ink)]/75">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}