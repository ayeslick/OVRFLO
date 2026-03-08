interface Props {
  title: string;
  description: string;
  details?: string[];
}

export function StatusPanel({ title, description, details = [] }: Props) {
  return (
    <div className="rounded-xl border border-red-500/40 bg-red-950/40 p-4 text-sm text-red-100">
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-2 text-red-100/90">{description}</p>
      {details.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-red-100/80">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}