# Gate 1 synthetic audio

Five fictional utterances produced with FFmpeg's Flite speech synthesis filter.
`manifest.json` records the spoken text, duration, container, codec and SHA-256
for each recording. The speech contains no participant recordings. The contact
fixtures use a reserved example domain and a fictional phone number.

Keep the WebM and MP4 samples as separate upload cases. The WAV sample is a
codec control. IT-1.2 also records a synthetic utterance with MediaRecorder and
verifies the live provider, fallback and redaction pipeline. A fixture integrity
pass verifies the assets before the pipeline runs.
