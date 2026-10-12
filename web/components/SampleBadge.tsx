export function SampleBadge({ sample }: { sample: boolean }) {
  if (!sample) return null;
  return (
    <span className="chip chip-sample" title="Illustrative sample derived from the spec. Replaced by real lab output when it lands.">
      <span className="dot-i" aria-hidden="true" /> sample data
    </span>
  );
}
