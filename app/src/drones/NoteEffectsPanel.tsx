import {
  HARMONIC_COUNT,
  HARMONIC_OCTAVE_OFFSETS,
  HARMONIC_VOICE_DEFAULTS,
  NOTE_FX_DEFAULTS,
  harmonicLayerDefaultSemitones,
  resolveNoteFx,
  type DroneLfoShape,
  type DroneNote,
  type HarmonicVoice,
} from "../state";
import { Card, LFO_SHAPES, LfoScope, Slider } from "./SynthSection";

const HARMONIC_LABELS = ["-1", "0", "+1", "+2", "+3", "Ext 1", "Ext 2", "Ext 3"];
const INTERVAL_OPTIONS: Array<{ semitones: number; label: string }> = [
  { semitones: -24, label: "-24 · -2 octaves" },
  { semitones: -21, label: "-21 · -13th" },
  { semitones: -19, label: "-19 · -12th (P5 + 8ve)" },
  { semitones: -17, label: "-17 · -11th (P4 + 8ve)" },
  { semitones: -15, label: "-15 · -10th (M3 + 8ve)" },
  { semitones: -14, label: "-14 · -9th (M2 + 8ve)" },
  { semitones: -12, label: "-12 · -octave" },
  { semitones: -10, label: "-10 · -m7" },
  { semitones: -9, label: "-9 · -M6" },
  { semitones: -8, label: "-8 · -m6" },
  { semitones: -7, label: "-7 · -P5" },
  { semitones: -5, label: "-5 · -P4" },
  { semitones: -4, label: "-4 · -M3" },
  { semitones: -3, label: "-3 · -m3" },
  { semitones: -2, label: "-2 · -M2" },
  { semitones: -1, label: "-1 · -m2" },
  { semitones: 0, label: "0 · Unison" },
  { semitones: 1, label: "+1 · m2" },
  { semitones: 2, label: "+2 · M2" },
  { semitones: 3, label: "+3 · m3" },
  { semitones: 4, label: "+4 · M3" },
  { semitones: 5, label: "+5 · P4" },
  { semitones: 7, label: "+7 · P5" },
  { semitones: 8, label: "+8 · m6" },
  { semitones: 9, label: "+9 · M6" },
  { semitones: 10, label: "+10 · m7" },
  { semitones: 11, label: "+11 · M7" },
  { semitones: 12, label: "+12 · octave" },
  { semitones: 14, label: "+14 · 9th" },
  { semitones: 15, label: "+15 · 10th" },
  { semitones: 17, label: "+17 · 11th" },
  { semitones: 19, label: "+19 · 12th" },
  { semitones: 21, label: "+21 · 13th" },
  { semitones: 24, label: "+24 · 2 octaves" },
];

/**
 * Per-note effect editor shown under the timeline whenever a note is
 * selected. Includes the fundamental controls (Vol/pitch, unison,
 * tremolo, filter) followed by a full mini-synth per harmonic partial,
 * each with its own tremolo (amplitude LFO) and drift (pitch LFO) plus
 * live scope readouts.
 */
export function NoteEffectsPanel({
  note,
  onChange,
}: {
  note: DroneNote;
  onChange: (patch: Partial<DroneNote>) => void;
}) {
  const fx = resolveNoteFx(note);

  const setHarmonic = (index: number, patch: Partial<HarmonicVoice>) => {
    const next = fx.harmonics.map((h) => ({ ...h }));
    next[index] = { ...next[index], ...patch };
    onChange({ harmonics: next });
  };
  const clearHarmonics = () =>
    onChange({
      harmonics: Array.from({ length: HARMONIC_COUNT }, (_, i) => ({
        ...HARMONIC_VOICE_DEFAULTS,
        intervalSemitones: harmonicLayerDefaultSemitones(i),
      })),
    });
  const resetTremolo = () =>
    onChange({
      tremoloRateHz: NOTE_FX_DEFAULTS.tremoloRateHz,
      tremoloDepth: NOTE_FX_DEFAULTS.tremoloDepth,
      tremoloShape: NOTE_FX_DEFAULTS.tremoloShape,
    });
  const resetFilter = () =>
    onChange({
      filterHz: NOTE_FX_DEFAULTS.filterHz,
      filterQ: NOTE_FX_DEFAULTS.filterQ,
      filterLfoRateHz: NOTE_FX_DEFAULTS.filterLfoRateHz,
      filterLfoDepth: NOTE_FX_DEFAULTS.filterLfoDepth,
      filterLfoShape: NOTE_FX_DEFAULTS.filterLfoShape,
    });

  return (
    <section
      style={{
        marginTop: 10,
        padding: 12,
        borderRadius: 8,
        background: "rgba(56,189,248,0.06)",
        border: "1px solid rgba(56,189,248,0.25)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 12, letterSpacing: 0.3 }}>
          Note effects · {note.note}
        </strong>
        <span style={{ opacity: 0.6, fontSize: 11 }}>
          (per-note, applied before the master chain)
        </span>
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "stretch",
        }}
      >
        <Card title="Layer mix">
          <Slider
            label="Mix"
            value={fx.gain}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ gain: v })}
          />
          <div style={{ fontSize: 10, opacity: 0.65 }}>
            Overall gain applied to the summed octave + extension layers.
          </div>
        </Card>

        <Card title="Composite tremolo">
          <Slider
            label="Rate"
            value={fx.tremoloRateHz}
            min={0.05}
            max={20}
            step={0.01}
            unit="Hz"
            logScale
            onChange={(v) => onChange({ tremoloRateHz: v })}
          />
          <Slider
            label="Depth"
            value={fx.tremoloDepth}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ tremoloDepth: v })}
          />
          <ShapePicker
            value={fx.tremoloShape}
            onChange={(s) => onChange({ tremoloShape: s })}
          />
          <LfoScope
            rateHz={fx.tremoloRateHz}
            depth={fx.tremoloDepth}
            shape={fx.tremoloShape}
            colorStroke="#f472b6"
            colorFill="rgba(244,114,182,0.15)"
            label={`${fx.tremoloRateHz.toFixed(2)} Hz × ${(fx.tremoloDepth * 100).toFixed(0)}%`}
          />
          <ResetLink onClick={resetTremolo} />
        </Card>

        <Card title="Composite filter">
          <Slider
            label="Cutoff"
            value={fx.filterHz}
            min={60}
            max={20000}
            step={10}
            unit="Hz"
            logScale
            onChange={(v) => onChange({ filterHz: v })}
          />
          <Slider
            label="Q"
            value={fx.filterQ}
            min={0.1}
            max={12}
            step={0.05}
            onChange={(v) => onChange({ filterQ: v })}
          />
          <Slider
            label="Cutoff trem rate"
            value={fx.filterLfoRateHz}
            min={0.05}
            max={20}
            step={0.01}
            unit="Hz"
            logScale
            onChange={(v) => onChange({ filterLfoRateHz: v })}
          />
          <Slider
            label="Cutoff trem depth"
            value={fx.filterLfoDepth}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ filterLfoDepth: v })}
          />
          <ShapePicker
            value={fx.filterLfoShape}
            onChange={(s) => onChange({ filterLfoShape: s })}
          />
          <LfoScope
            rateHz={fx.filterLfoRateHz}
            depth={fx.filterLfoDepth}
            shape={fx.filterLfoShape}
            colorStroke="#38bdf8"
            colorFill="rgba(56,189,248,0.15)"
            label={`cutoff ${fx.filterHz.toFixed(0)} Hz ↓ ${(fx.filterLfoDepth * 5).toFixed(1)} oct`}
          />
          <ResetLink onClick={resetFilter} />
        </Card>
      </div>

      <HarmonicsSection
        harmonics={fx.harmonics}
        onChange={setHarmonic}
        onClear={clearHarmonics}
      />
    </section>
  );
}

/**
 * Harmonic partial editors — one row per partial (2×..8×). Each row is
 * its own mini-synth: Level, Tremolo (rate + depth), Drift (cents +
 * rate), and two live scopes so you can *see* the modulation happening.
 * A compact summary column on the left shows the current level as a
 * bar for at-a-glance context.
 */
function HarmonicsSection({
  harmonics,
  onChange,
  onClear,
}: {
  harmonics: HarmonicVoice[];
  onChange: (index: number, patch: Partial<HarmonicVoice>) => void;
  onClear: () => void;
}) {
  return (
    <section
      style={{
        padding: "10px 0 4px",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 12, letterSpacing: 0.3 }}>
          Layers
        </strong>
        <span style={{ opacity: 0.6, fontSize: 11 }}>
          octaves -1..+3 plus 3 extension notes (interval in semitones)
        </span>
        <ResetLink onClick={onClear} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {harmonics.map((h, i) => (
          <HarmonicRow
            key={i}
            index={i}
            harmonic={h}
            onChange={(patch) => onChange(i, patch)}
          />
        ))}
      </div>
    </section>
  );
}

function HarmonicRow({
  index,
  harmonic,
  onChange,
}: {
  index: number;
  harmonic: HarmonicVoice;
  onChange: (patch: Partial<HarmonicVoice>) => void;
}) {
  const active = harmonic.level > 0.001;
  const isExtension = index >= HARMONIC_OCTAVE_OFFSETS.length;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "80px minmax(200px, 1fr) minmax(240px, 1fr) minmax(240px, 1fr)",
        gap: 10,
        alignItems: "stretch",
        padding: 8,
        borderRadius: 6,
        background: active ? "rgba(34,197,94,0.06)" : "rgba(255,255,255,0.02)",
        border: `1px solid ${active ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.08)"}`,
      }}
    >
      {/* Summary — partial label + level bar. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {HARMONIC_LABELS[index]}
        </div>
        <div
          title={`Level ${Math.round(harmonic.level * 100)}%`}
          style={{
            width: 20,
            flex: 1,
            minHeight: 60,
            display: "flex",
            alignItems: "flex-end",
            background: "rgba(0,0,0,0.35)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: "100%",
              height: `${Math.round(harmonic.level * 100)}%`,
              background: "linear-gradient(180deg, #38bdf8, #22c55e)",
              opacity: 0.9,
            }}
          />
        </div>
      </div>

      {/* Level (raw slider takes vertical space; combined with trem/drift). */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {isExtension ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
            <span style={{ opacity: 0.75 }}>Interval</span>
            <select
              value={String(harmonic.intervalSemitones)}
              onChange={(e) =>
                onChange({ intervalSemitones: parseInt(e.target.value, 10) || 0 })
              }
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.06)",
                color: "rgba(207,214,230,0.95)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 4,
                padding: "4px 6px",
                fontSize: 11,
              }}
            >
              {INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.semitones} value={opt.semitones}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div style={{ fontSize: 10, opacity: 0.75 }}>
            Octave layer fixed at {harmonicLayerDefaultSemitones(index) / 12 > 0 ? "+" : ""}
            {harmonicLayerDefaultSemitones(index) / 12} oct
          </div>
        )}
        <Slider
          label="Level"
          value={harmonic.level}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ level: v })}
        />
        <Slider
          label="Overtones"
          value={harmonic.overtones}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ overtones: v })}
        />
        <div style={{ fontSize: 10, opacity: 0.6 }}>
          0 = pure sine · 1 = bright (saw-like). Adds partials that
          break sine beating.
        </div>
      </div>

      {/* Tremolo mini-synth. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 11, opacity: 0.75, fontWeight: 600 }}>
          Tremolo
        </div>
        <Slider
          label="Rate"
          value={harmonic.tremRateHz}
          min={0.05}
          max={20}
          step={0.01}
          unit="Hz"
          logScale
          onChange={(v) => onChange({ tremRateHz: v })}
        />
        <Slider
          label="Depth"
          value={harmonic.tremDepth}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ tremDepth: v })}
        />
        <LfoScope
          rateHz={harmonic.tremRateHz}
          depth={harmonic.tremDepth}
          shape="sine"
          colorStroke="#f472b6"
          colorFill="rgba(244,114,182,0.15)"
          label={`${harmonic.tremRateHz.toFixed(2)} Hz × ${(harmonic.tremDepth * 100).toFixed(0)}%`}
        />
      </div>

      {/* Drift mini-synth. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 11, opacity: 0.75, fontWeight: 600 }}>
          Drift
        </div>
        <Slider
          label="Depth"
          value={harmonic.driftCents}
          min={0}
          max={50}
          step={0.1}
          unit="c"
          onChange={(v) => onChange({ driftCents: v })}
        />
        <Slider
          label="Rate"
          value={harmonic.driftRateHz}
          min={0.02}
          max={5}
          step={0.01}
          unit="Hz"
          logScale
          onChange={(v) => onChange({ driftRateHz: v })}
        />
        <LfoScope
          rateHz={harmonic.driftRateHz}
          depth={Math.min(1, harmonic.driftCents / 50)}
          shape="sine"
          colorStroke="#38bdf8"
          colorFill="rgba(56,189,248,0.15)"
          label={`±${harmonic.driftCents.toFixed(1)} c @ ${harmonic.driftRateHz.toFixed(2)} Hz`}
        />
      </div>
    </div>
  );
}

function ShapePicker({
  value,
  onChange,
}: {
  value: DroneLfoShape;
  onChange: (s: DroneLfoShape) => void;
}) {
  return (
    <label
      style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}
    >
      <span style={{ width: 60 }}>Shape</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as DroneLfoShape)}
        style={{
          flex: 1,
          background: "rgba(255,255,255,0.06)",
          color: "rgba(207,214,230,0.95)",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 4,
          padding: "2px 6px",
          fontSize: 11,
        }}
      >
        {LFO_SHAPES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}

function ResetLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        marginLeft: "auto",
        background: "transparent",
        color: "rgba(207,214,230,0.6)",
        border: "none",
        fontSize: 10,
        cursor: "pointer",
        textDecoration: "underline",
        padding: 2,
      }}
    >
      reset
    </button>
  );
}
