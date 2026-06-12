interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export default function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
      <span>⚠️ {message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded px-2 py-0.5 text-rose-500 hover:bg-rose-100"
      >
        Dismiss
      </button>
    </div>
  );
}
