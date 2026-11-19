import { useState, type ClipboardEvent, type FormEvent } from 'react';
import { verifyApiKey } from '../../../agent/anthropic';
import { setApiKey } from '../../../lib/secrets';
import type { ModelId } from '../../../lib/settings';

export function ApiKeyForm({ model, onSaved, autoFocus }: { model: ModelId; onSaved: () => void; autoFocus?: boolean }) {
  const [value, setValue] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'checking' } | { kind: 'error'; message: string }>({ kind: 'idle' });

  const save = async (key: string) => {
    if (!key || state.kind === 'checking') return;
    setState({ kind: 'checking' });
    try {
      await verifyApiKey(key, model);
      await setApiKey(key);
      setValue('');
      setState({ kind: 'idle' });
      onSaved();
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save(value.trim());
  };

  // Pasting a whole key is the common case: check it right away, no extra click.
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').trim();
    if (!pasted.startsWith('sk-ant-') || value.trim() !== '') return;
    event.preventDefault();
    setValue(pasted);
    void save(pasted);
  };

  return (
    <form className="key-form" onSubmit={submit}>
      <div className="key-form-row">
        <input
          className="input"
          type="password"
          placeholder="sk-ant-…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPaste={onPaste}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          aria-label="Anthropic API key"
        />
        <button className="button primary" type="submit" disabled={!value.trim() || state.kind === 'checking'}>
          {state.kind === 'checking' ? 'Checking…' : 'Save'}
        </button>
      </div>
      {state.kind === 'error' && <p className="form-error">{state.message}</p>}
    </form>
  );
}
