# MIDI Grid

A browser-based MIDI sequencer with Web Audio playback and MIDI output support.

## Getting Started

```bash
npm install
npm run dev
```

Opens at http://localhost:5173

## Connecting to GarageBand (macOS)

### 1. Enable the IAC Driver

- Open **Audio MIDI Setup** (in `/Applications/Utilities/`)
- Press `Cmd+2` or go to **Window > Show MIDI Studio**
- Double-click **IAC Driver**
- Check **"Device is online"**
- Click Apply

### 2. Set up GarageBand

- Create a new **Software Instrument** track
- Select any instrument (piano, synth, etc.)
- GarageBand automatically listens to all MIDI inputs

### 3. Connect the Sequencer

- Click the **MIDI OFF** button to toggle it to **MIDI ON**
- Select **IAC Driver Bus 1** from the dropdown
- Hit play - GarageBand will play the notes using its instruments

## Browser Support

Web MIDI API requires **Chrome** or **Edge**. Safari does not support Web MIDI.

Grant MIDI permissions when prompted by the browser.
