import React, { useEffect, useRef, useState } from 'react';

/**
 * DictationButton - speech to text through the browser's own recognizer
 * (Web Speech API). Chrome / Edge / Safari; the button is hidden where the
 * API does not exist (Firefox). Recognition runs in the browser vendor's
 * service, so nothing is sent to our server.
 *
 * Final phrases are handed to `onText` as they are recognized; the phrase in
 * progress is shown under the button. Chrome ends a session after a pause, so
 * it is restarted until the user stops.
 *
 * Props:
 *   onText(text)  - called with each recognized phrase
 *   lang          - initial BCP-47 language, e.g. 'fr-FR'
 *   labels        - { start, stop, listening, denied, unsupported, error }
 */
const LANGS = [
  { value: 'fr-FR', label: 'FR' },
  { value: 'en-GB', label: 'EN' },
  { value: 'it-IT', label: 'IT' },
  { value: 'de-DE', label: 'DE' },
  { value: 'es-ES', label: 'ES' }
];

const getRecognitionClass = () => (typeof window === 'undefined'
  ? null
  : (window.SpeechRecognition || window.webkitSpeechRecognition || null));

export default function DictationButton({ onText, lang: initialLang = 'fr-FR', labels = {}, disabled = false }) {
  const RecognitionClass = getRecognitionClass();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState(null);
  const [lang, setLang] = useState(initialLang);
  const recognitionRef = useRef(null);
  // The user's intent, read by onend to decide whether to restart
  const wantListeningRef = useRef(false);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stop = () => {
    wantListeningRef.current = false;
    setListening(false);
    setInterim('');
    try { recognitionRef.current?.stop(); } catch (e) { /* already stopped */ }
  };

  // Stop the microphone when the editor closes
  useEffect(() => () => {
    wantListeningRef.current = false;
    try { recognitionRef.current?.abort(); } catch (e) { /* ignore */ }
  }, []);

  const start = () => {
    if (!RecognitionClass) return;
    setError(null);
    const recognition = new RecognitionClass();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript || '';
        if (result.isFinal) {
          if (text.trim()) onTextRef.current?.(text.trim());
        } else {
          pending += text;
        }
      }
      setInterim(pending);
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        wantListeningRef.current = false;
        setError(labels.denied || 'Microphone access was refused.');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError(`${labels.error || 'Dictation error'}: ${event.error}`);
      }
    };
    recognition.onend = () => {
      setInterim('');
      if (wantListeningRef.current) {
        // Chrome closes the session after a pause; carry on until stopped
        try { recognition.start(); return; } catch (e) { /* fall through */ }
      }
      wantListeningRef.current = false;
      setListening(false);
    };

    recognitionRef.current = recognition;
    wantListeningRef.current = true;
    try {
      recognition.start();
      setListening(true);
    } catch (e) {
      wantListeningRef.current = false;
      setError(`${labels.error || 'Dictation error'}: ${e.message}`);
    }
  };

  if (!RecognitionClass) {
    return (
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {labels.unsupported || 'Dictation is not available in this browser (use Chrome, Edge or Safari).'}
      </span>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={listening ? stop : start}
          disabled={disabled}
          title={listening ? labels.stop : labels.start}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer',
            border: listening ? '1px solid #dc2626' : '1px solid var(--border-color)',
            background: listening ? 'rgba(220, 38, 38, 0.10)' : 'var(--bg-primary)',
            color: listening ? '#dc2626' : 'var(--text-primary)'
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: listening ? '#dc2626' : 'var(--text-muted)',
              animation: listening ? 'dictation-pulse 1.2s ease-in-out infinite' : 'none'
            }}
          />
          {listening ? (labels.stop || 'Stop dictation') : (labels.start || 'Dictate')}
        </button>
        <select
          value={lang}
          onChange={e => setLang(e.target.value)}
          disabled={listening}
          title="Language"
          style={{
            padding: '7px 6px',
            borderRadius: 6,
            fontSize: 12,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)'
          }}
        >
          {LANGS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
        {listening && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{labels.listening || 'Listening…'}</span>
        )}
      </div>
      {interim && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>{interim}</div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: '#dc2626' }}>{error}</div>
      )}
      <style>{'@keyframes dictation-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }'}</style>
    </div>
  );
}
