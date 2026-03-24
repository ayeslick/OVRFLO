interface Props {
  title: string;
  description: string;
  details?: string[];
}

export function StatusPanel({ title, description, details = [] }: Props) {
  return (
    <div className="nb-status nb-status-error" data-testid="panel-status-error">
      <p className="nb-kicker text-[#b13a57]">System notice</p>
      <h3 className="mt-2 text-base font-bold uppercase tracking-wide text-black">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-black/80">{description}</p>
      {details.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-black/70">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
