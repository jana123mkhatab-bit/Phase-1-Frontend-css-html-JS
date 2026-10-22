// Mic button widget for voice input. Renders nothing when the browser has no speech recognition.
// props: { onResult(text), disabled }
import { html, bool } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { createSpeech, speechSupported } from './speech.js';

const NOTE_KEY = 'speech-note-seen';

export default function mic(view) {
  view.state.sp = { listening: false, interim: '', error: null };
  view.state.first = false;
  const speech = createSpeech({
    onChange: (s) => view.set({ sp: s }),
    onFinal: (text) => view.state.props.onResult?.(text),
  });
  view.onCleanup(() => speech.destroy());
  view.listen(document, 'keydown', (e) => { if (e.key === 'Escape' && view.state.sp.listening) speech.stop(); });
  return {
    render: () => {
      if (!speechSupported) return '';
      const { sp, first, props } = view.state;
      return html`<span class="mic">
        <button type="button" class="btn secondary mic-btn" data-click="toggle" ${props.disabled ? 'disabled' : ''} aria-pressed="${bool(sp.listening)}" aria-label="${t('Speak')}" title="${t('Speak')}">${icon('mic')}${sp.listening ? html`<span class="mic-dot" aria-hidden="true"></span>` : ''}</button>
        ${sp.listening ? html`<span class="mic-state muted">${t('Listening…')}${sp.interim ? ` ${sp.interim}` : ''}</span>` : ''}
        <span class="sr-only" aria-live="polite">${sp.listening ? t('Listening…') : ''}</span>
        ${sp.error ? html`<span class="mic-err" role="alert">${sp.error}</span>` : ''}
        ${first ? html`<span class="mic-note muted">${t('Your browser may send audio to its speech service to turn it into text. Nothing is stored by Campus in Motion.')}</span>` : ''}
      </span>`;
    },
    actions: {
      toggle: () => {
        if (view.state.sp.listening) { speech.stop(); return; }
        try { if (!localStorage.getItem(NOTE_KEY)) { view.state.first = true; localStorage.setItem(NOTE_KEY, '1'); } } catch { /* ignore */ }
        speech.start();
      },
    },
  };
}
