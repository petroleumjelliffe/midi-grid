import React, { useState, useRef, useEffect, useCallback } from 'react';

const BEATS = 8; // 8th notes in one 4/4 bar
const MIN_PITCH = 48; // C3
const MAX_PITCH = 72; // C5
const GRID_ROWS = MAX_PITCH - MIN_PITCH + 1;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const INSTRUMENTS = [
  { name: 'Piano', type: 'triangle', attack: 0.02, decay: 0.3 },
  { name: 'Organ', type: 'sine', attack: 0.05, decay: 0.1 },
  { name: 'Lead Synth', type: 'sawtooth', attack: 0.01, decay: 0.2 },
  { name: 'Square Lead', type: 'square', attack: 0.01, decay: 0.15 },
  { name: 'Bass', type: 'triangle', attack: 0.01, decay: 0.4 },
];

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function midiToNoteName(midi) {
  return NOTE_NAMES[midi % 12] + Math.floor(midi / 12 - 1);
}

export default function MidiController() {
  const [notes, setNotes] = useState([
    { id: 1, beat: 0, duration: 1, pitch: 60 },
    { id: 2, beat: 2, duration: 2, pitch: 64 },
    { id: 3, beat: 5, duration: 1, pitch: 67 },
    { id: 4, beat: 6, duration: 2, pitch: 62 },
  ]);
  const [selectedId, setSelectedId] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(-1);
  const [tempo, setTempo] = useState(120);
  const [instrument, setInstrument] = useState(INSTRUMENTS[0]);
  const [dragState, setDragState] = useState(null);
  const [playingNotes, setPlayingNotes] = useState(new Set());
  
  // MIDI state
  const [midiAccess, setMidiAccess] = useState(null);
  const [midiOutputs, setMidiOutputs] = useState([]);
  const [selectedMidiOutput, setSelectedMidiOutput] = useState(null);
  const [midiChannel, setMidiChannel] = useState(1);
  const [midiEnabled, setMidiEnabled] = useState(false);
  const [midiSupported] = useState(() => !!navigator.requestMIDIAccess);
  const [warningDismissed, setWarningDismissed] = useState(false);

  const gridRef = useRef(null);
  const audioContextRef = useRef(null);
  const intervalRef = useRef(null);
  const nextIdRef = useRef(10);
  const activeMidiNotes = useRef(new Map()); // Track active notes for proper note-off

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  // Initialize MIDI
  useEffect(() => {
    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess({ sysex: false })
        .then((access) => {
          setMidiAccess(access);
          updateMidiOutputs(access);
          
          // Listen for device changes
          access.onstatechange = () => updateMidiOutputs(access);
        })
        .catch((err) => {
          console.warn('MIDI access denied:', err);
        });
    }
  }, []);

  const updateMidiOutputs = (access) => {
    const outputs = [];
    for (const output of access.outputs.values()) {
      outputs.push({ id: output.id, name: output.name });
    }
    setMidiOutputs(outputs);
    
    // Auto-select first output if none selected
    if (outputs.length > 0 && !selectedMidiOutput) {
      setSelectedMidiOutput(outputs[0].id);
    }
  };

  const sendMidiNoteOn = useCallback((pitch, velocity = 100) => {
    if (!midiEnabled || !midiAccess || !selectedMidiOutput) return;
    
    const output = midiAccess.outputs.get(selectedMidiOutput);
    if (output) {
      const noteOn = 0x90 + (midiChannel - 1); // Note On + channel
      output.send([noteOn, pitch, velocity]);
    }
  }, [midiEnabled, midiAccess, selectedMidiOutput, midiChannel]);

  const sendMidiNoteOff = useCallback((pitch) => {
    if (!midiAccess || !selectedMidiOutput) return;
    
    const output = midiAccess.outputs.get(selectedMidiOutput);
    if (output) {
      const noteOff = 0x80 + (midiChannel - 1); // Note Off + channel
      output.send([noteOff, pitch, 0]);
    }
  }, [midiAccess, selectedMidiOutput, midiChannel]);

  const stopAllMidiNotes = useCallback(() => {
    // Send note-off for all active notes
    activeMidiNotes.current.forEach((_, pitch) => {
      sendMidiNoteOff(pitch);
    });
    activeMidiNotes.current.clear();
  }, [sendMidiNoteOff]);

  const playNote = useCallback((pitch, durationSec, velocity = 100) => {
    // Web Audio (always plays for preview)
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = instrument.type;
    osc.frequency.value = midiToFreq(pitch);

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + instrument.attack);
    gain.gain.exponentialRampToValueAtTime(0.01, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + durationSec);

    // MIDI output
    sendMidiNoteOn(pitch, velocity);
    
    // Schedule note-off
    setTimeout(() => {
      sendMidiNoteOff(pitch);
    }, durationSec * 1000);
  }, [instrument, getAudioContext, sendMidiNoteOn, sendMidiNoteOff]);

  // Playback loop
  useEffect(() => {
    if (isPlaying) {
      const msPerBeat = (60 / tempo) * 1000 / 2;

      const tick = () => {
        setCurrentBeat(prev => {
          const next = (prev + 1) % BEATS;

          // Play notes starting at this beat
          const starting = notes.filter(n => n.beat === next);
          starting.forEach(note => {
            const dur = (60 / tempo) * note.duration / 2;
            playNote(note.pitch, dur);
          });

          // Track which notes are currently playing
          const active = new Set();
          notes.forEach(n => {
            if (next >= n.beat && next < n.beat + n.duration) {
              active.add(n.id);
            }
          });
          setPlayingNotes(active);

          return next;
        });
      };

      tick(); // Play first beat immediately
      intervalRef.current = setInterval(tick, msPerBeat);

      return () => clearInterval(intervalRef.current);
    } else {
      setPlayingNotes(new Set());
    }
  }, [isPlaying, tempo, notes, playNote]);

  const handlePlay = () => {
    getAudioContext().resume();
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
    stopAllMidiNotes();
  };

  const handleRewind = () => {
    setIsPlaying(false);
    setCurrentBeat(-1);
    setPlayingNotes(new Set());
    stopAllMidiNotes();
  };

  // Grid interactions
  const getGridPosition = (e) => {
    const rect = gridRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const beatWidth = rect.width / BEATS;
    const pitch = MAX_PITCH - Math.floor((y / rect.height) * GRID_ROWS);
    const beat = Math.floor(x / beatWidth);
    return { beat: Math.max(0, Math.min(BEATS - 1, beat)), pitch: Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch)), rect };
  };

  const findNoteAt = (beat, pitch) => {
    return notes.find(n =>
      beat >= n.beat && beat < n.beat + n.duration && n.pitch === pitch
    );
  };

  const handleGridClick = (e) => {
    if (isPlaying) return;

    const { beat, pitch } = getGridPosition(e);
    const existingNote = findNoteAt(beat, pitch);

    if (existingNote) {
      setSelectedId(existingNote.id);
    } else {
      // Check if any note occupies this beat (regardless of pitch)
      const noteAtBeat = notes.find(n => beat >= n.beat && beat < n.beat + n.duration);
      if (!noteAtBeat) {
        const newNote = {
          id: nextIdRef.current++,
          beat,
          duration: 1,
          pitch
        };
        setNotes(prev => [...prev, newNote]);
        setSelectedId(newNote.id);
        playNote(pitch, 0.15);
      } else {
        setSelectedId(null);
      }
    }
  };

  const handleNoteMouseDown = (e, noteId, dragType) => {
    if (isPlaying) return;
    e.preventDefault();
    e.stopPropagation();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const note = notes.find(n => n.id === noteId);
    const rect = gridRef.current.getBoundingClientRect();

    setSelectedId(noteId);
    setDragState({
      noteId,
      dragType,
      startX: clientX,
      startY: clientY,
      original: { ...note },
      beatWidth: rect.width / BEATS,
      rowHeight: rect.height / GRID_ROWS
    });
  };

  useEffect(() => {
    if (!dragState) return;

    const handleMove = (e) => {
      e.preventDefault();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      
      const { noteId, dragType, startX, startY, original, beatWidth, rowHeight } = dragState;

      setNotes(prev => prev.map(note => {
        if (note.id !== noteId) return note;

        if (dragType === 'pitch') {
          const deltaRows = Math.round((startY - clientY) / rowHeight);
          const newPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, original.pitch + deltaRows));
          return { ...note, pitch: newPitch };
        }

        if (dragType === 'left') {
          const deltaBeats = Math.round((clientX - startX) / beatWidth);
          const newBeat = Math.max(0, Math.min(original.beat + original.duration - 1, original.beat + deltaBeats));
          const newDuration = original.duration - (newBeat - original.beat);
          return { ...note, beat: newBeat, duration: newDuration };
        }

        if (dragType === 'right') {
          const deltaBeats = Math.round((clientX - startX) / beatWidth);
          const newDuration = Math.max(1, Math.min(BEATS - original.beat, original.duration + deltaBeats));
          return { ...note, duration: newDuration };
        }

        return note;
      }));
    };

    const handleUp = () => {
      if (dragState.dragType === 'pitch') {
        const note = notes.find(n => n.id === dragState.noteId);
        if (note) playNote(note.pitch, 0.15);
      }
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMove, { passive: false });
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [dragState, notes, playNote]);

  const handleDelete = () => {
    if (selectedId && !isPlaying) {
      setNotes(prev => prev.filter(n => n.id !== selectedId));
      setSelectedId(null);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDelete();
      }
      if (e.key === 'Escape') {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, isPlaying]);

  const gridRect = gridRef.current?.getBoundingClientRect();

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0c0c10',
      padding: '24px 32px',
      fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
      color: '#e4e4e7'
    }}>
      {/* Browser Warning */}
      {!midiSupported && !warningDismissed && (
        <div style={{
          background: 'rgba(251, 146, 60, 0.15)',
          border: '1px solid rgba(251, 146, 60, 0.3)',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px'
        }}>
          <span style={{ fontSize: '13px', color: '#fb923c' }}>
            Your browser does not support Web MIDI. MIDI output is disabled. Use Chrome or Edge for full functionality.
          </span>
          <button
            onClick={() => setWarningDismissed(true)}
            style={{
              background: 'none',
              border: 'none',
              color: '#fb923c',
              cursor: 'pointer',
              fontSize: '18px',
              padding: '0 4px',
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '20px'
      }}>
        <h1 style={{
          margin: 0,
          fontSize: '13px',
          fontWeight: 600,
          letterSpacing: '2px',
          color: '#71717a',
          textTransform: 'uppercase'
        }}>
          MIDI Sequencer
        </h1>
        <div style={{
          fontSize: '11px',
          color: '#3f3f46',
          letterSpacing: '1px'
        }}>
          1 BAR • 4/4 • 8TH NOTES
        </div>
      </header>

      {/* Transport Controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        marginBottom: '20px',
        padding: '16px 20px',
        background: '#18181b',
        borderRadius: '12px',
        border: '1px solid #27272a'
      }}>
        {/* Rewind */}
        <button
          onClick={handleRewind}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '8px',
            border: '1px solid #3f3f46',
            background: '#27272a',
            color: '#a1a1aa',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px'
          }}
          title="Back to start"
        >
          ⏮
        </button>

        {/* Play/Pause */}
        <button
          onClick={isPlaying ? handlePause : handlePlay}
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '10px',
            border: 'none',
            background: isPlaying
              ? 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)'
              : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: isPlaying
              ? '0 4px 16px rgba(249, 115, 22, 0.4)'
              : '0 4px 16px rgba(34, 197, 94, 0.4)'
          }}
        >
          {isPlaying ? (
            <div style={{ display: 'flex', gap: '4px' }}>
              <div style={{ width: '4px', height: '18px', background: '#fff', borderRadius: '2px' }} />
              <div style={{ width: '4px', height: '18px', background: '#fff', borderRadius: '2px' }} />
            </div>
          ) : (
            <div style={{
              width: 0,
              height: 0,
              borderTop: '9px solid transparent',
              borderBottom: '9px solid transparent',
              borderLeft: '14px solid #fff',
              marginLeft: '3px'
            }} />
          )}
        </button>

        {/* Divider */}
        <div style={{ width: '1px', height: '32px', background: '#27272a', margin: '0 8px' }} />

        {/* Tempo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label style={{ fontSize: '10px', color: '#71717a', letterSpacing: '1px' }}>BPM</label>
          <input
            type="range"
            min="60"
            max="200"
            value={tempo}
            onChange={(e) => setTempo(Number(e.target.value))}
            disabled={isPlaying}
            style={{
              width: '80px',
              accentColor: '#6366f1',
              opacity: isPlaying ? 0.4 : 1
            }}
          />
          <span style={{
            fontSize: '16px',
            fontWeight: 700,
            minWidth: '36px',
            fontVariantNumeric: 'tabular-nums'
          }}>{tempo}</span>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '32px', background: '#27272a', margin: '0 8px' }} />

        {/* Instrument */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label style={{ fontSize: '10px', color: '#71717a', letterSpacing: '1px' }}>PATCH</label>
          <select
            value={instrument.name}
            onChange={(e) => setInstrument(INSTRUMENTS.find(i => i.name === e.target.value))}
            style={{
              background: '#27272a',
              border: '1px solid #3f3f46',
              borderRadius: '6px',
              color: '#e4e4e7',
              padding: '8px 12px',
              fontSize: '13px',
              cursor: 'pointer',
              fontFamily: 'inherit'
            }}
          >
            {INSTRUMENTS.map(i => (
              <option key={i.name} value={i.name}>{i.name}</option>
            ))}
          </select>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '32px', background: '#27272a', margin: '0 8px' }} />

        {/* MIDI Output */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => setMidiEnabled(!midiEnabled)}
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: midiEnabled ? '1px solid #22c55e' : '1px solid #3f3f46',
              background: midiEnabled ? 'rgba(34, 197, 94, 0.15)' : '#27272a',
              color: midiEnabled ? '#4ade80' : '#71717a',
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '1px',
              fontFamily: 'inherit'
            }}
          >
            MIDI {midiEnabled ? 'ON' : 'OFF'}
          </button>
          
          {midiEnabled && (
            <>
              <select
                value={selectedMidiOutput || ''}
                onChange={(e) => setSelectedMidiOutput(e.target.value)}
                style={{
                  background: '#27272a',
                  border: '1px solid #3f3f46',
                  borderRadius: '6px',
                  color: '#e4e4e7',
                  padding: '8px 12px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  maxWidth: '160px'
                }}
              >
                {midiOutputs.length === 0 ? (
                  <option value="">No MIDI outputs</option>
                ) : (
                  midiOutputs.map(output => (
                    <option key={output.id} value={output.id}>{output.name}</option>
                  ))
                )}
              </select>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ fontSize: '10px', color: '#71717a' }}>CH</label>
                <select
                  value={midiChannel}
                  onChange={(e) => setMidiChannel(Number(e.target.value))}
                  style={{
                    background: '#27272a',
                    border: '1px solid #3f3f46',
                    borderRadius: '4px',
                    color: '#e4e4e7',
                    padding: '4px 8px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    width: '52px'
                  }}
                >
                  {Array.from({ length: 16 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        {/* Status */}
        <div style={{
          marginLeft: 'auto',
          display: 'flex',
          gap: '8px',
          alignItems: 'center'
        }}>
          {midiEnabled && selectedMidiOutput && (
            <div style={{
              padding: '6px 10px',
              borderRadius: '16px',
              background: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '1px',
              color: '#818cf8',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#818cf8',
                animation: 'pulse 2s infinite'
              }} />
              MIDI
            </div>
          )}
          <div style={{
            padding: '6px 14px',
            borderRadius: '16px',
            background: isPlaying ? 'rgba(249, 115, 22, 0.15)' : 'rgba(34, 197, 94, 0.15)',
            border: `1px solid ${isPlaying ? 'rgba(249, 115, 22, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '1px',
            color: isPlaying ? '#fb923c' : '#4ade80'
          }}>
            {isPlaying ? '▶ PLAYING' : '✎ EDIT'}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div style={{ display: 'flex' }}>
        {/* Y-axis labels */}
        <div style={{
          width: '44px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          paddingRight: '8px',
          height: '360px'
        }}>
          {[72, 66, 60, 54, 48].map(p => (
            <span key={p} style={{
              fontSize: '10px',
              color: '#52525b',
              textAlign: 'right'
            }}>{midiToNoteName(p)}</span>
          ))}
        </div>

        {/* Main grid area */}
        <div
          ref={gridRef}
          onClick={handleGridClick}
          style={{
            flex: 1,
            height: '360px',
            background: '#111114',
            borderRadius: '8px',
            border: '1px solid #27272a',
            position: 'relative',
            cursor: isPlaying ? 'not-allowed' : 'crosshair',
            touchAction: 'none'
          }}
        >
          {/* Vertical beat lines */}
          {Array.from({ length: BEATS + 1 }).map((_, i) => (
            <div
              key={`v${i}`}
              style={{
                position: 'absolute',
                left: `${(i / BEATS) * 100}%`,
                top: 0,
                bottom: 0,
                width: i === 0 || i === BEATS ? 0 : '1px',
                background: i % 2 === 0 ? '#3f3f46' : '#27272a'
              }}
            />
          ))}

          {/* Horizontal pitch lines */}
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={`h${i}`}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${(i / 4) * 100}%`,
                height: '1px',
                background: '#27272a'
              }}
            />
          ))}

          {/* Beat numbers */}
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={`beat${i}`}
              style={{
                position: 'absolute',
                left: `${((i * 2 + 1) / BEATS) * 100}%`,
                bottom: '6px',
                transform: 'translateX(-50%)',
                fontSize: '11px',
                color: '#52525b',
                fontWeight: 600
              }}
            >
              {i + 1}
            </div>
          ))}

          {/* Playhead */}
          {currentBeat >= 0 && (
            <div style={{
              position: 'absolute',
              left: `${(currentBeat / BEATS) * 100}%`,
              width: `${100 / BEATS}%`,
              top: 0,
              bottom: 0,
              background: isPlaying ? 'rgba(251, 146, 60, 0.12)' : 'rgba(99, 102, 241, 0.1)',
              borderLeft: `2px solid ${isPlaying ? '#f97316' : '#6366f1'}`,
              pointerEvents: 'none',
              transition: isPlaying ? 'none' : 'left 0.15s ease'
            }} />
          )}

          {/* Notes (bar graph style) */}
          {gridRect && notes.map(note => {
            const isSelected = selectedId === note.id;
            const isActive = playingNotes.has(note.id);
            const barHeight = 20;
            const bottomPadding = 28;
            const usableHeight = gridRect.height - bottomPadding;
            const yPos = usableHeight - ((note.pitch - MIN_PITCH) / (MAX_PITCH - MIN_PITCH)) * usableHeight - barHeight / 2;

            return (
              <div
                key={note.id}
                style={{
                  position: 'absolute',
                  left: `calc(${(note.beat / BEATS) * 100}% + 2px)`,
                  width: `calc(${(note.duration / BEATS) * 100}% - 4px)`,
                  top: yPos,
                  height: barHeight,
                  background: isActive
                    ? 'linear-gradient(90deg, #fb923c 0%, #f97316 100%)'
                    : isSelected
                    ? 'linear-gradient(90deg, #818cf8 0%, #6366f1 100%)'
                    : 'linear-gradient(90deg, #6366f1 0%, #4f46e5 100%)',
                  borderRadius: '4px',
                  boxShadow: isActive
                    ? '0 0 16px rgba(251, 146, 60, 0.5)'
                    : isSelected
                    ? '0 0 0 2px rgba(129, 140, 248, 0.5)'
                    : '0 2px 8px rgba(0,0,0,0.3)',
                  cursor: isPlaying ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'box-shadow 0.1s, background 0.1s',
                  touchAction: 'none'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isPlaying) setSelectedId(note.id);
                }}
              >
                {/* Note label */}
                <span style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  color: 'rgba(255,255,255,0.9)',
                  pointerEvents: 'none',
                  textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                }}>
                  {midiToNoteName(note.pitch)}
                </span>

                {/* Pitch handle (top) */}
                {!isPlaying && (
                  <div
                    onMouseDown={(e) => handleNoteMouseDown(e, note.id, 'pitch')}
                    onTouchStart={(e) => handleNoteMouseDown(e, note.id, 'pitch')}
                    style={{
                      position: 'absolute',
                      top: '-6px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: '24px',
                      height: '10px',
                      background: isSelected ? '#a5b4fc' : '#818cf8',
                      borderRadius: '5px 5px 2px 2px',
                      cursor: 'ns-resize',
                      opacity: isSelected ? 1 : 0,
                      transition: 'opacity 0.15s',
                      boxShadow: '0 -2px 4px rgba(0,0,0,0.2)',
                      touchAction: 'none'
                    }}
                  />
                )}

                {/* Left duration handle */}
                {!isPlaying && (
                  <div
                    onMouseDown={(e) => handleNoteMouseDown(e, note.id, 'left')}
                    onTouchStart={(e) => handleNoteMouseDown(e, note.id, 'left')}
                    style={{
                      position: 'absolute',
                      left: '-4px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: '8px',
                      height: '14px',
                      background: isSelected ? '#a5b4fc' : '#818cf8',
                      borderRadius: '4px 2px 2px 4px',
                      cursor: 'ew-resize',
                      opacity: isSelected ? 1 : 0,
                      transition: 'opacity 0.15s',
                      touchAction: 'none'
                    }}
                  />
                )}

                {/* Right duration handle */}
                {!isPlaying && (
                  <div
                    onMouseDown={(e) => handleNoteMouseDown(e, note.id, 'right')}
                    onTouchStart={(e) => handleNoteMouseDown(e, note.id, 'right')}
                    style={{
                      position: 'absolute',
                      right: '-4px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: '8px',
                      height: '14px',
                      background: isSelected ? '#a5b4fc' : '#818cf8',
                      borderRadius: '2px 4px 4px 2px',
                      cursor: 'ew-resize',
                      opacity: isSelected ? 1 : 0,
                      transition: 'opacity 0.15s',
                      touchAction: 'none'
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Help text */}
      <div style={{
        marginTop: '16px',
        display: 'flex',
        gap: '20px',
        flexWrap: 'wrap',
        fontSize: '11px',
        color: '#52525b'
      }}>
        <span><kbd style={kbdStyle}>Click</kbd> Add/select note</span>
        <span><kbd style={kbdStyle}>Drag ↕</kbd> Adjust pitch</span>
        <span><kbd style={kbdStyle}>Drag ↔</kbd> Adjust duration</span>
        <span><kbd style={kbdStyle}>Del</kbd> Delete selected</span>
        <span><kbd style={kbdStyle}>Esc</kbd> Deselect</span>
      </div>
    </div>
  );
}

const kbdStyle = {
  display: 'inline-block',
  padding: '2px 6px',
  background: '#27272a',
  borderRadius: '3px',
  fontFamily: 'inherit',
  marginRight: '4px'
};
