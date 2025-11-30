
import React, { useEffect, useRef } from 'react';
import * as Vex from 'vexflow';
import { NoteEvent, LabelSettings } from '../types';
import { MusicNotationService } from '../services/musicNotationService';
import { PIXELS_PER_SECOND } from './constants';

interface SheetMusicProps {
  notes: NoteEvent[];
  currentTime: number;
  totalDuration: number;
  bpm?: number;
  onNoteClick: (noteId: string) => void;
  selectedNoteId: string | null;
  labelSettings: LabelSettings;
  scrollRef?: React.RefObject<HTMLDivElement>;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
}

const SheetMusic: React.FC<SheetMusicProps> = ({ 
    notes, currentTime, totalDuration, bpm = 120, onNoteClick, selectedNoteId, labelSettings, scrollRef, onScroll 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // @ts-ignore
  const rendererRef = useRef<Vex.Flow.Renderer | null>(null);

  // Constants
  const MEASURE_WIDTH = 250;
  
  // Logic: Sync scroll to playhead
  useEffect(() => {
    if (scrollRef && scrollRef.current) {
        // Beats per second = BPM / 60
        // Playhead Beat = currentTime * (BPM/60)
        // Pixels = Playhead Beat * (MEASURE_WIDTH / 4)  [assuming 4/4]
        
        const beatsPerSecond = bpm / 60;
        const currentBeat = currentTime * beatsPerSecond;
        const pixelsPerBeat = MEASURE_WIDTH / 4;
        
        // Offset: First stave padding (~20px)
        const playheadX = 20 + (currentBeat * pixelsPerBeat);
        
        const containerWidth = scrollRef.current.clientWidth;
        const targetScroll = playheadX - (containerWidth / 2);
        
        if (Math.abs(scrollRef.current.scrollLeft - targetScroll) > 50) { 
           scrollRef.current.scrollTo({
               left: Math.max(0, targetScroll),
               behavior: 'smooth'
           });
        }
    }
  }, [currentTime, bpm, scrollRef]);

  // Logic: Render VexFlow
  useEffect(() => {
      if (!containerRef.current) return;
      if (notes.length === 0) return;

      // 1. Clear previous
      while (containerRef.current.firstChild) {
          containerRef.current.removeChild(containerRef.current.firstChild);
      }

      // 2. Process Notes into Measures
      const measures = MusicNotationService.processNotes(notes, bpm);
      
      if (measures.length === 0) return;

      // 3. Setup VexFlow Renderer
      // VexFlow 4.x ESM export handling - Robust Check
      // @ts-ignore
      const VF = Vex.Flow || (Vex.default && Vex.default.Flow) || Vex;
      
      if (!VF || !VF.Renderer) {
          console.error("VexFlow library not loaded correctly", Vex);
          return;
      }

      const width = Math.max(800, measures.length * MEASURE_WIDTH + 50);
      const height = 280; // Treble + Bass + spacing

      const renderer = new VF.Renderer(containerRef.current, VF.Renderer.Backends.SVG);
      renderer.resize(width, height);
      const context = renderer.getContext();
      rendererRef.current = renderer;

      // Styling
      context.setFont("Inter", 10, "").setBackgroundFillStyle("#ffffff");

      // 4. Render Measures Loop
      let currentX = 10;
      
      measures.forEach((measure, i) => {
          // --- TREBLE STAVE ---
          const staveTreble = new VF.Stave(currentX, 20, MEASURE_WIDTH);
          if (i === 0) {
              staveTreble.addClef("treble").addTimeSignature("4/4");
          }
          staveTreble.setContext(context).draw();

          // --- BASS STAVE ---
          const staveBass = new VF.Stave(currentX, 130, MEASURE_WIDTH); // 130y offset
          if (i === 0) {
              staveBass.addClef("bass").addTimeSignature("4/4");
          }
          staveBass.setContext(context).draw();

          // Connect staves with brace at start
          if (i === 0) {
              new VF.StaveConnector(staveTreble, staveBass).setType(VF.StaveConnector.type.BRACE).setContext(context).draw();
              new VF.StaveConnector(staveTreble, staveBass).setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(context).draw();
          }
          // Barline at end
          new VF.StaveConnector(staveTreble, staveBass).setType(VF.StaveConnector.type.SINGLE_RIGHT).setContext(context).draw();


          // --- NOTES GENERATION ---
          // Filter notes for this measure
          const trebleNotes = measure.notes.filter(n => n.staff === 'treble');
          const bassNotes = measure.notes.filter(n => n.staff === 'bass');

          const createVexNotes = (measureNotes: NoteEvent[], clef: string) => {
              if (measureNotes.length === 0) {
                  // Full measure rest
                  return [new VF.StaveNote({ clef, keys: [clef === 'treble' ? "b/4" : "d/3"], duration: "wr" })];
              }

              // Group by start time for chords
              const groups: {[key: number]: NoteEvent[]} = {};
              measureNotes.forEach(n => {
                  const t = n.startBeat!;
                  if (!groups[t]) groups[t] = [];
                  groups[t].push(n);
              });

              const vfNotes: any[] = [];
              const sortedTimes = Object.keys(groups).map(Number).sort((a,b) => a-b);
              
              sortedTimes.forEach((time, idx) => {
                  const group = groups[time];
                  // Determine Duration based on first note in group
                  const durBeats = group[0].durationBeats || 1;
                  const vfDur = MusicNotationService.getVexFlowDuration(durBeats);

                  // Keys: "c/4", "eb/5"
                  const keys = group.map(n => {
                      // MIDI to Note Name
                      const noteName = n.pitch_label?.replace(/\d+/, '').toLowerCase() || "c";
                      const octave = Math.floor(n.midi_pitch / 12) - 1;
                      return `${noteName}/${octave}`;
                  });

                  // Modifiers (Accidentals)
                  const staveNote = new VF.StaveNote({ keys, duration: vfDur, clef });
                  
                  // Color selection
                  const isSelected = group.some(n => n.id === selectedNoteId);
                  if (isSelected) staveNote.setStyle({ fillStyle: "#4f46e5", strokeStyle: "#4f46e5" });

                  // Apply Accidentals
                  group.forEach((n, idx) => {
                      const noteName = n.pitch_label || "";
                      if (noteName.includes("#")) staveNote.addModifier(new VF.Accidental("#"), idx);
                      if (noteName.includes("b")) staveNote.addModifier(new VF.Accidental("b"), idx);
                  });

                  // Pitch Labels (Annotations)
                  if (labelSettings.showLabels) {
                      group.forEach((n, idx) => {
                          const label = n.pitch_label || "";
                          const position = clef === 'treble' ? VF.Modifier.Position.ABOVE : VF.Modifier.Position.BELOW;
                          
                          const annotation = new VF.Annotation(label)
                              .setFont("Inter", 9, "normal") // Sans-serif, small
                              .setVerticalJustification(position === VF.Modifier.Position.ABOVE ? VF.Annotation.VerticalJustify.BOTTOM : VF.Annotation.VerticalJustify.TOP);
                          
                          staveNote.addModifier(annotation, idx);
                      });
                  }
                  
                  vfNotes.push(staveNote);
              });

              return vfNotes;
          };

          const vNotesTreble = createVexNotes(trebleNotes, "treble");
          const vNotesBass = createVexNotes(bassNotes, "bass");

          // Create Voices
          const voiceTreble = new VF.Voice({ num_beats: 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT);
          voiceTreble.addTickables(vNotesTreble);

          const voiceBass = new VF.Voice({ num_beats: 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT);
          voiceBass.addTickables(vNotesBass);

          // Format and Draw
          // Align treble and bass
          new VF.Formatter()
              .joinVoices([voiceTreble])
              .joinVoices([voiceBass])
              .format([voiceTreble, voiceBass], MEASURE_WIDTH - 50);

          voiceTreble.draw(context, staveTreble);
          voiceBass.draw(context, staveBass);
          
          currentX += MEASURE_WIDTH;
      });
      
      // Draw Playhead Overlay (Manual SVG on top of VexFlow)
      const beatsPerSecond = bpm / 60;
      const currentBeat = currentTime * beatsPerSecond;
      const pixelsPerBeat = MEASURE_WIDTH / 4;
      const playheadX = 10 + 20 + (currentBeat * pixelsPerBeat); // 10 margin + 20 padding

      context.beginPath();
      context.moveTo(playheadX, 20);
      context.lineTo(playheadX, 260);
      context.setStrokeStyle("#ef4444");
      context.setLineWidth(1.5);
      context.stroke();

  }, [notes, bpm, labelSettings, selectedNoteId]);

  return (
    <div 
        ref={scrollRef}
        onScroll={onScroll}
        className="w-full h-[320px] overflow-x-auto bg-white rounded-t-lg shadow-sm relative select-none flex"
    >
        <div ref={containerRef} className="h-full min-w-full bg-white" />
    </div>
  );
};

export default SheetMusic;