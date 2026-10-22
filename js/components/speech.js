import { getLang, t } from '../core/i18n.js';

const Ctor = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const speechSupported = Boolean(Ctor);

// Plain-language messages for each SpeechRecognition error code (NFR-03).
const messageFor = (code) => {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed': return t('Microphone access was blocked. Allow it in your browser settings, then try again.');
    case 'no-speech': return t('We did not hear anything. Try again.');
    case 'network': return t('Voice input needs an internet connection. Type instead.');
    case 'audio-capture': return t('No microphone was found.');
    case 'language-not-supported': return t('Voice input is not available for this language in your browser. Type instead.');
    default: return t('Voice input stopped. Try again or type instead.');
  }
};

/** Browser speech-to-text. Never starts by itself: call start() from a click. Language follows the UI language. */
export function createSpeech({ onChange, onFinal }) {
  const s = { listening: false, interim: '', error: null };
  let rec = null;
  const emit = () => onChange?.({ ...s });
  return {
    get state() { return { ...s }; },
    stop() { try { rec?.stop(); } catch { /* ignore */ } },
    destroy() { try { rec?.abort(); } catch { /* ignore */ } rec = null; },
    start() {
      if (!Ctor || rec) return;
      s.interim = ''; s.error = null;
      const r = new Ctor();
      r.lang = getLang() === 'ar' ? 'ar-EG' : 'en-US';
      r.continuous = false;
      r.interimResults = true;
      r.onresult = (e) => {
        let fin = ''; let int = '';
        for (let i = 0; i < e.results.length; i++) {
          if (e.results[i].isFinal) fin += e.results[i][0].transcript; else int += e.results[i][0].transcript;
        }
        s.interim = int; emit();
        if (fin) onFinal?.(fin.trim());
      };
      r.onerror = (e) => { if (e.error !== 'aborted') { s.error = messageFor(e.error); emit(); } };
      r.onend = () => { rec = null; s.listening = false; s.interim = ''; emit(); };
      rec = r;
      try { r.start(); s.listening = true; emit(); } catch { rec = null; s.error = messageFor(); emit(); }
    },
  };
}
