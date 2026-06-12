const PROMPTS = [
  'Plan a 7-day trip to Tokyo for 2 in October under $3000 total',
  'Find me flights from Seattle to Lisbon in September',
  'Compare Airbnb vs hotels in Barcelona for a long weekend',
  'Road trip from Seattle to Portland — flights, car, and a nice Airbnb',
];

interface SuggestedPromptsProps {
  onPick: (prompt: string) => void;
}

export default function SuggestedPrompts({ onPick }: SuggestedPromptsProps) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <div className="text-4xl">🧭</div>
      <h1 className="mt-3 text-2xl font-semibold text-ink">Where to next?</h1>
      <p className="mt-1 text-slate-500">
        I'm Wayfarer — tell me where you want to go and I'll search flights, stays, cars, and
        activities all at once.
      </p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            className="rounded-xl border border-slate-200 bg-white p-4 text-left text-sm text-slate-700 shadow-sm transition hover:border-wayfarer-500 hover:shadow"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
