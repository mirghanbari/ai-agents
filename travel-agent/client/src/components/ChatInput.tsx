import { useState, type KeyboardEvent } from 'react';

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
  subscriptionMode: boolean;
  subscriptionAvailable: boolean;
  onToggleSubscription: (on: boolean) => void;
}

export default function ChatInput({
  onSend,
  disabled,
  subscriptionMode,
  subscriptionAvailable,
  onToggleSubscription,
}: ChatInputProps) {
  const [value, setValue] = useState('');

  const submit = (): void => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const modes = [
    { on: false, label: '💳 Credits', title: 'Bill Anthropic API credits (POST /api/chat)' },
    { on: true, label: '✦ Subscription', title: 'Bill your Claude Pro/Max plan via the Agent SDK (POST /api/chat/subscription)' },
  ];

  return (
    <div className="border-t border-slate-200 bg-white p-3">
      {subscriptionAvailable && (
        <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2">
          <span className="text-xs text-slate-400">Billing</span>
          <div
            role="group"
            aria-label="Billing mode"
            className="inline-flex rounded-lg border border-slate-200 p-0.5"
          >
            {modes.map((m) => {
              const active = m.on === subscriptionMode;
              return (
                <button
                  key={m.label}
                  type="button"
                  title={m.title}
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() => onToggleSubscription(m.on)}
                  className={
                    'rounded-md px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ' +
                    (active ? 'bg-wayfarer-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100')
                  }
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Ask Wayfarer to plan a trip…  (Enter to send, Shift+Enter for newline)"
          className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-wayfarer-500 focus:outline-none focus:ring-2 focus:ring-wayfarer-100"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || value.trim().length === 0}
          className="h-[44px] rounded-xl bg-wayfarer-600 px-5 text-sm font-medium text-white transition hover:bg-wayfarer-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
