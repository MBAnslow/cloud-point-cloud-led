import { useCallback, useMemo, useRef, useState } from "react";
import {
  useSimStore,
  hourInRange,
  activeWindowProgress,
  periodsCrossingActiveWindow,
  cloneColorTracks,
  BOLT_INTENSITY_TAGS,
  BOLT_LENGTH_TAGS,
  type BreathParticipant,
  type BoltIntensityTag,
  type BoltLengthTag,
  type LightningAnimParams,
  type LightningColorStop,
  type LightningColorTracks,
  type LightningKeyframe,
  type LightningParams,
  type LightningSample,
  type LightningSpriteSample,
  type DayPeriod,
} from "../state";
import { useDraggable } from "./useDraggable";
import { RangeSlider } from "./RangeSlider";
import { putSampleBlob, deleteSampleBlob } from "../samples/sampleStorage";
import { invalidateSpriteImage } from "../lighting/spriteImageCache";
import {
  applyLightningTint,
  isRangePlotChannel,
  plotChannelMax,
  sampleLightningKeyframe,
  sampleLightningColorTracks,
  samplePlotChannel,
  samplePlotChannelRange,
  interpolateLightningColorStops,
  type LightningPlotChannel,
} from "../lighting/lightning";

/** Suffix for params that ride the flash keyframe envelope. */
const KF = "*";

type ColorChannel = "main" | "highlight1" | "highlight2";

const CHANNEL_LABELS: Record<ColorChannel, string> = {
  main: "Main",
  highlight1: "Hl 1",
  highlight2: "Hl 2",
};

const PIN_SIZE = 12;
const TRACK_HEIGHT = 18;

/**
 * Draggable lightning controls. Asterisked params are edited on the
 * selected keyframe and interpolate across the active window on the
 * sky timeline; the rest stay global.
 */
export function LightningPanel({ visible = true }: { visible?: boolean }) {
  const lightning = useSimStore((s) => s.lightning);
  const setLightning = useSimStore((s) => s.setLightning);
  const dayPeriods = useSimStore((s) => s.dayCycle.periods);
  const participants = useSimStore((s) => s.breath.participants);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { pos, handleProps } = useDraggable(panelRef);
  const dynStyle: React.CSSProperties = pos
    ? { top: pos.top, left: pos.left, bottom: "auto", right: "auto" }
    : {};

  const sorted = useMemo(
    () => [...lightning.keyframes].sort((a, b) => a.t - b.t),
    [lightning.keyframes],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [plotChannel, setPlotChannel] =
    useState<LightningPlotChannel>("intensity");
  const skyTimeHours = useSimStore((s) => s.sky.timeHours);
  const selected =
    sorted.find((k) => k.id === selectedId) ?? sorted[0] ?? null;
  const anim: LightningAnimParams = {
    intensityRange:
      selected?.values.intensityRange ?? lightning.intensityRange,
    strikesPerMinute:
      selected?.values.strikesPerMinute ?? lightning.strikesPerMinute,
    strikePerMinute:
      selected?.values.strikePerMinute ?? lightning.strikePerMinute,
    spritesPerMinute:
      selected?.values.spritesPerMinute ?? lightning.spritesPerMinute,
    subFlashes: selected?.values.subFlashes ?? lightning.subFlashes,
    spanScale: selected?.values.spanScale ?? lightning.spanScale,
    minSpanScale: selected?.values.minSpanScale ?? lightning.minSpanScale,
    boltGain: selected?.values.boltGain ?? lightning.boltGain,
    spriteGain: selected?.values.spriteGain ?? lightning.spriteGain,
    backgroundGain: selected?.values.backgroundGain ?? lightning.backgroundGain,
    thunderDelayMs: selected?.values.thunderDelayMs ?? lightning.thunderDelayMs,
    pan: selected?.values.pan ?? lightning.pan,
    tintMix: selected?.values.tintMix ?? lightning.tintMix ?? 0.35,
  };
  const inActiveWindow = hourInRange(
    skyTimeHours,
    lightning.activeStartHour,
    lightning.activeEndHour,
  );
  const playheadU = activeWindowProgress(
    skyTimeHours,
    lightning.activeStartHour,
    lightning.activeEndHour,
  );

  if (!visible) return null;

  const upd = (patch: Partial<LightningParams>) => setLightning(patch);

  const setKeyframes = (keyframes: LightningKeyframe[]) => {
    upd({ keyframes });
  };

  const patchAnim = (patch: Partial<LightningAnimParams>) => {
    if (!selected) return;
    const nextValues: LightningAnimParams = {
      ...selected.values,
      ...patch,
    };
    if (patch.intensityRange) {
      nextValues.intensityRange = [
        patch.intensityRange[0],
        patch.intensityRange[1],
      ];
    }
    if (patch.spanScale !== undefined || patch.minSpanScale !== undefined) {
      const hi = Math.max(0, Math.min(1, nextValues.spanScale));
      const lo = Math.max(0, Math.min(hi, nextValues.minSpanScale));
      nextValues.spanScale = hi;
      nextValues.minSpanScale = lo;
    }
    if (patch.tintMix !== undefined) {
      nextValues.tintMix = Math.max(0, Math.min(1, nextValues.tintMix));
    }
    const keyframes = lightning.keyframes.map((k) =>
      k.id === selected.id ? { ...k, values: nextValues } : k,
    );
    upd({
      keyframes,
      intensityRange: nextValues.intensityRange,
      strikesPerMinute: nextValues.strikesPerMinute,
      strikePerMinute: nextValues.strikePerMinute,
      spritesPerMinute: nextValues.spritesPerMinute,
      subFlashes: nextValues.subFlashes,
      spanScale: nextValues.spanScale,
      minSpanScale: nextValues.minSpanScale,
      boltGain: nextValues.boltGain,
      spriteGain: nextValues.spriteGain,
      backgroundGain: nextValues.backgroundGain,
      thunderDelayMs: nextValues.thunderDelayMs,
      pan: nextValues.pan,
      tintMix: nextValues.tintMix,
    });
  };

  const plotLabel =
    plotChannel === "intensity"
      ? "intensity"
      : plotChannel === "strikesPerMinute"
        ? "cloud/min"
        : plotChannel === "strikePerMinute"
          ? "strike/min"
          : plotChannel === "spritesPerMinute"
            ? "sprites/min"
            : plotChannel === "subFlashes"
              ? "branch prob"
              : plotChannel === "span"
                ? "span"
                : plotChannel === "boltGain"
                  ? "bolt gain"
                  : plotChannel === "spriteGain"
                    ? "sprite gain"
                    : plotChannel === "backgroundGain"
                      ? "bg gain"
                      : plotChannel === "thunderDelay"
                        ? "thunder delay"
                        : plotChannel === "tintMix"
                          ? "tint mix"
                          : "pan";

  return (
    <div ref={panelRef} style={{ ...panelStyle, ...dynStyle }}>
      <div
        onPointerDown={handleProps.onPointerDown}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "move",
          flexShrink: 0,
        }}
      >
        <div style={titleStyle}>Lightning</div>
        <label style={inlineLabel}>
          <input
            type="checkbox"
            checked={lightning.enabled}
            onChange={(e) => upd({ enabled: e.target.checked })}
          />
          enabled
        </label>
      </div>
      <div style={panelScrollStyle}>
        <KeyframeEditor
          keyframes={lightning.keyframes}
          selectedId={selected?.id ?? null}
          plotChannel={plotChannel}
          plotLabel={plotLabel}
          playheadU={inActiveWindow ? playheadU : null}
          activeStartHour={lightning.activeStartHour}
          activeEndHour={lightning.activeEndHour}
          periods={dayPeriods}
          onSelect={setSelectedId}
          onChange={setKeyframes}
        />
        <div style={{ fontSize: 9, opacity: 0.55, marginBottom: 2 }}>
          {KF} = changes across the active window (sky timeline). Click a
          label to plot; yellow line = current time.
        </div>
        <LightningColourEditor
          colors={lightning.colors}
          participants={participants}
          tintMix={anim.tintMix}
          playheadU={inActiveWindow ? playheadU : null}
          onChangeColors={(colors) => upd({ colors })}
          onChangeTintMix={(tintMix) => patchAnim({ tintMix })}
          onPlotTintMix={() => setPlotChannel("tintMix")}
          tintMixPlotActive={plotChannel === "tintMix"}
        />
        <div style={threeColStyle}>
          <div style={colStyle}>
            <RangeRow
              label={`Intensity${KF}`}
              labelActive={plotChannel === "intensity"}
              onLabelClick={() => setPlotChannel("intensity")}
              min={0}
              max={3}
              step={0.01}
              low={anim.intensityRange[0]}
              high={anim.intensityRange[1]}
              onChange={(lo, hi) => patchAnim({ intensityRange: [lo, hi] })}
              format={(lo, hi) => `${lo.toFixed(2)} – ${hi.toFixed(2)}`}
            />
            <SliderRow
              label={`Cloud / min${KF}`}
              labelActive={plotChannel === "strikesPerMinute"}
              onLabelClick={() => setPlotChannel("strikesPerMinute")}
              value={anim.strikesPerMinute}
              min={0}
              max={40}
              step={1}
              onChange={(v) => patchAnim({ strikesPerMinute: v })}
              formatValue={(v) => `${v.toFixed(0)}/min`}
            />
            <SliderRow
              label={`Strike / min${KF}`}
              labelActive={plotChannel === "strikePerMinute"}
              onLabelClick={() => setPlotChannel("strikePerMinute")}
              value={anim.strikePerMinute}
              min={0}
              max={40}
              step={0.1}
              onChange={(v) =>
                patchAnim({ strikePerMinute: Math.max(0, Math.min(40, v)) })
              }
              formatValue={(v) => `${v.toFixed(1)}/min`}
            />
            <SliderRow
              label={`Sprites / min${KF}`}
              labelActive={plotChannel === "spritesPerMinute"}
              onLabelClick={() => setPlotChannel("spritesPerMinute")}
              value={anim.spritesPerMinute}
              min={0}
              max={40}
              step={0.1}
              onChange={(v) =>
                patchAnim({ spritesPerMinute: Math.max(0, Math.min(40, v)) })
              }
              formatValue={(v) => `${v.toFixed(1)}/min`}
            />
            <SliderRow
              label={`Sprite gain${KF}`}
              labelActive={plotChannel === "spriteGain"}
              onLabelClick={() => setPlotChannel("spriteGain")}
              value={anim.spriteGain}
              min={0}
              max={3}
              step={0.05}
              onChange={(v) =>
                patchAnim({ spriteGain: Math.max(0, Math.min(3, v)) })
              }
              formatValue={(v) => v.toFixed(2)}
            />
            <SliderRow
              label="Sprite duration"
              value={lightning.spriteDurationMs}
              min={40}
              max={800}
              step={10}
              onChange={(v) =>
                upd({ spriteDurationMs: Math.max(20, Math.min(2000, v)) })
              }
              formatValue={(v) => `${v.toFixed(0)} ms`}
            />
            <SliderRow
              label="Sprite strobe"
              value={lightning.spriteStrobeHz}
              min={1}
              max={40}
              step={1}
              onChange={(v) =>
                upd({ spriteStrobeHz: Math.max(1, Math.min(60, v)) })
              }
              formatValue={(v) => `${v.toFixed(0)} Hz`}
            />
            <SliderRow
              label="Strobe duty"
              value={lightning.spriteStrobeDuty}
              min={0.05}
              max={0.95}
              step={0.05}
              onChange={(v) =>
                upd({
                  spriteStrobeDuty: Math.max(0.05, Math.min(0.95, v)),
                })
              }
              formatValue={(v) => `${(v * 100).toFixed(0)}%`}
            />
            {lightning.enabled && !inActiveWindow && (
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(255,190,120,0.9)",
                  margin: "2px 0 4px",
                }}
              >
                Outside active window — scrub the sky time or widen Start/End
                hour so strikes can fire.
              </div>
            )}
            <SliderRow
              label="Light falloff"
              min={0}
              max={0.2}
              step={0.005}
              value={lightning.falloffDistance}
              onChange={(v) =>
                upd({ falloffDistance: Math.max(0, Math.min(0.2, v)) })
              }
              formatValue={(v) => `${v.toFixed(3)} m`}
            />
            <SliderRow
              label="Segments"
              value={lightning.boltSegments}
              min={4}
              max={24}
              step={1}
              onChange={(v) => upd({ boltSegments: Math.round(v) })}
              formatValue={(v) => v.toFixed(0)}
            />
            <RangeRow
              label="Jitter"
              min={0}
              max={1}
              step={0.01}
              low={lightning.boltJitterRange[0]}
              high={lightning.boltJitterRange[1]}
              onChange={(lo, hi) => upd({ boltJitterRange: [lo, hi] })}
              format={(lo, hi) => `${lo.toFixed(2)} – ${hi.toFixed(2)}`}
            />
            <RangeRow
              label="Travel (m/s)"
              min={0.1}
              max={5}
              step={0.05}
              low={lightning.travelSpeedRange[0]}
              high={lightning.travelSpeedRange[1]}
              onChange={(lo, hi) => upd({ travelSpeedRange: [lo, hi] })}
              format={(lo, hi) => `${lo.toFixed(1)} – ${hi.toFixed(1)}`}
            />
            <SliderRow
              label={`Sub-flashes${KF}`}
              labelActive={plotChannel === "subFlashes"}
              onLabelClick={() => setPlotChannel("subFlashes")}
              value={anim.subFlashes}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) =>
                patchAnim({ subFlashes: Math.max(0, Math.min(1, v)) })
              }
              formatValue={(v) => v.toFixed(2)}
            />
            <RangeRow
              label={`Span${KF}`}
              labelActive={plotChannel === "span"}
              onLabelClick={() => setPlotChannel("span")}
              min={0}
              max={1}
              step={0.01}
              low={Math.min(1, anim.minSpanScale)}
              high={anim.spanScale}
              onChange={(lo, hi) =>
                patchAnim({ minSpanScale: lo, spanScale: hi })
              }
              format={(lo, hi) => `${lo.toFixed(2)} – ${hi.toFixed(2)}`}
            />
            <SliderRow
              label="Sim FPS"
              value={lightning.simFps}
              min={1}
              max={60}
              step={1}
              onChange={(v) => upd({ simFps: Math.round(v) })}
              formatValue={(v) => `${v.toFixed(0)} fps`}
            />
          </div>
          <div style={colStyle}>
            <div
              style={{
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                marginBottom: 4,
                paddingBottom: 4,
              }}
            >
              <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 4 }}>
                Active window (24h)
              </div>
              <SliderRow
                label="Start hour"
                value={lightning.activeStartHour}
                min={0}
                max={24}
                step={0.25}
                onChange={(v) => upd({ activeStartHour: v % 24 })}
                formatValue={(v) => `${v.toFixed(2)}h`}
              />
              <SliderRow
                label="End hour"
                value={lightning.activeEndHour}
                min={0}
                max={24}
                step={0.25}
                onChange={(v) => upd({ activeEndHour: v % 24 })}
                formatValue={(v) => `${v.toFixed(2)}h`}
              />
            </div>
            <AudioSection
              lightning={lightning}
              anim={anim}
              plotChannel={plotChannel}
              setPlotChannel={setPlotChannel}
              upd={upd}
              patchAnim={patchAnim}
            />
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              minWidth: 0,
              height: 0,
              minHeight: "100%",
              overflow: "hidden",
              borderLeft: "1px solid rgba(255,255,255,0.08)",
              paddingLeft: 10,
            }}
          >
            <BoltSamplesColumn lightning={lightning} upd={upd} />
            <SpriteSamplesColumn lightning={lightning} upd={upd} />
          </div>
        </div>
      </div>
    </div>
  );
}

function cloneAnim(v: LightningAnimParams): LightningAnimParams {
  return {
    intensityRange: [v.intensityRange[0], v.intensityRange[1]],
    strikesPerMinute: v.strikesPerMinute,
    strikePerMinute: v.strikePerMinute,
    spritesPerMinute: v.spritesPerMinute,
    subFlashes: v.subFlashes,
    spanScale: v.spanScale,
    minSpanScale: v.minSpanScale,
    boltGain: v.boltGain,
    spriteGain: v.spriteGain,
    backgroundGain: v.backgroundGain,
    thunderDelayMs: v.thunderDelayMs,
    pan: v.pan,
    tintMix: v.tintMix,
  };
}

function makeColorStopId(): string {
  return `lcs-${Math.random().toString(36).slice(2, 8)}`;
}

type ColourSel = { channel: ColorChannel; id: string };

function LightningColourEditor({
  colors,
  participants,
  tintMix,
  playheadU,
  onChangeColors,
  onChangeTintMix,
  onPlotTintMix,
  tintMixPlotActive,
}: {
  colors: LightningColorTracks;
  participants: BreathParticipant[];
  tintMix: number;
  playheadU: number | null;
  onChangeColors: (colors: LightningColorTracks) => void;
  onChangeTintMix: (mix: number) => void;
  onPlotTintMix: () => void;
  tintMixPlotActive: boolean;
}) {
  const [selected, setSelected] = useState<ColourSel | null>(null);

  const setColorChannel = useCallback(
    (
      channel: ColorChannel,
      updater: (stops: LightningColorStop[]) => LightningColorStop[],
    ) => {
      onChangeColors({
        ...cloneColorTracks(colors),
        [channel]: updater(colors[channel]),
      });
    },
    [colors, onChangeColors],
  );

  const selectedStop: LightningColorStop | null = selected
    ? (colors[selected.channel].find((s) => s.id === selected.id) ?? null)
    : null;

  const livePreview = useMemo(() => {
    if (playheadU == null) return null;
    const base = sampleLightningColorTracks(colors, playheadU);
    return participants.slice(0, 4).map((p) => ({
      id: p.id,
      enabled: p.enabled,
      color: p.color,
      tinted: applyLightningTint(base, p.color, p.enabled ? tintMix : 0),
    }));
  }, [colors, participants, playheadU, tintMix]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        marginBottom: 6,
        paddingBottom: 6,
        borderBottom: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      <div style={{ fontSize: 10, opacity: 0.7 }}>
        Default lightning colours · click track to add · drag pin · click pin
        to edit
      </div>
      {(["main", "highlight1", "highlight2"] as ColorChannel[]).map(
        (channel) => (
          <ColourChannelTrack
            key={channel}
            label={CHANNEL_LABELS[channel]}
            stops={colors[channel]}
            playheadU={playheadU}
            selectedId={
              selected?.channel === channel ? selected.id : null
            }
            onSelect={(id) => setSelected({ channel, id })}
            onMove={(id, t) =>
              setColorChannel(channel, (stops) =>
                stops.map((s) => (s.id === id ? { ...s, t } : s)),
              )
            }
            onAdd={(t) => {
              const color = interpolateLightningColorStops(
                colors[channel],
                t,
                "#cfe7ff",
              );
              const newStop: LightningColorStop = {
                id: makeColorStopId(),
                t,
                color,
              };
              setColorChannel(channel, (stops) => [...stops, newStop]);
              setSelected({ channel, id: newStop.id });
            }}
          />
        ),
      )}

      <SliderRow
        label={`Tint mix${KF}`}
        labelActive={tintMixPlotActive}
        onLabelClick={onPlotTintMix}
        value={tintMix}
        min={0}
        max={1}
        step={0.01}
        onChange={onChangeTintMix}
        formatValue={(v) => `${(v * 100).toFixed(0)}%`}
      />
      <div style={{ fontSize: 9, opacity: 0.55 }}>
        How much each bolt pulls toward a random enabled breath
        participant&apos;s colour (from Breath). 0% = default lightning only.
      </div>

      {livePreview && livePreview.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          {livePreview.map((p, i) => (
            <span
              key={p.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                opacity: p.enabled ? 1 : 0.35,
              }}
              title={`P${i + 1} breath colour → tinted bolt`}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 8,
                  background: p.color,
                  border: "1px solid rgba(255,255,255,0.3)",
                }}
              />
              <span style={{ fontSize: 9, opacity: 0.6 }}>P{i + 1}</span>
              {([0, 1, 2] as const).map((s) => (
                <span
                  key={s}
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: p.tinted[s],
                    border: "1px solid rgba(255,255,255,0.25)",
                  }}
                />
              ))}
            </span>
          ))}
        </div>
      )}

      {selected && selectedStop && (
        <PaletteStopEditor
          title={`Default · ${CHANNEL_LABELS[selected.channel]} · ${(selectedStop.t * 100).toFixed(0)}%`}
          stop={selectedStop}
          onChange={(patch) => {
            setColorChannel(selected.channel, (stops) =>
              stops.map((s) =>
                s.id === selected.id ? { ...s, ...patch } : s,
              ),
            );
          }}
          onDelete={() => {
            setColorChannel(selected.channel, (stops) =>
              stops.filter((s) => s.id !== selected.id),
            );
            setSelected(null);
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function ColourChannelTrack({
  label,
  stops,
  playheadU,
  selectedId,
  onSelect,
  onMove,
  onAdd,
}: {
  label: string;
  stops: LightningColorStop[];
  playheadU: number | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, t: number) => void;
  onAdd: (t: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ id: string; wasDrag: boolean } | null>(null);

  const tFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = Math.min(Math.max(0, clientX - rect.left), rect.width);
    return x / Math.max(1, rect.width);
  }, []);

  const gradient = useMemo(() => {
    const SAMPLES = 64;
    const parts: string[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const u = i / SAMPLES;
      const c = interpolateLightningColorStops(stops, u, "#101828");
      const pct = ((i / SAMPLES) * 100).toFixed(2);
      parts.push(`${c} ${pct}%`);
    }
    return `linear-gradient(to right, ${parts.join(", ")})`;
  }, [stops]);

  const onPinPointerDown = useCallback(
    (e: React.PointerEvent, stop: LightningColorStop) => {
      e.stopPropagation();
      draggingRef.current = { id: stop.id, wasDrag: false };
      try {
        (e.target as Element).setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const onPinPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = draggingRef.current;
      if (!drag) return;
      drag.wasDrag = true;
      onMove(drag.id, tFromClientX(e.clientX));
    },
    [onMove, tFromClientX],
  );

  const onPinPointerUp = useCallback(
    (e: React.PointerEvent, stop: LightningColorStop) => {
      const drag = draggingRef.current;
      draggingRef.current = null;
      try {
        (e.target as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!drag?.wasDrag) onSelect(stop.id);
    },
    [onSelect],
  );

  const onTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (draggingRef.current) return;
      if (e.target !== e.currentTarget) return;
      onAdd(tFromClientX(e.clientX));
    },
    [onAdd, tFromClientX],
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          width: 36,
          fontSize: 10,
          opacity: 0.7,
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div
        ref={trackRef}
        onClick={onTrackClick}
        onPointerMove={onPinPointerMove}
        style={{
          position: "relative",
          flex: 1,
          height: TRACK_HEIGHT,
          background: gradient,
          borderRadius: 6,
          boxShadow: "0 0 0 1px rgba(255,255,255,0.06) inset",
          cursor: "copy",
        }}
      >
        {playheadU != null && (
          <div
            style={{
              position: "absolute",
              left: `${playheadU * 100}%`,
              top: -2,
              bottom: -2,
              width: 2,
              background: "rgba(255,220,90,0.95)",
              boxShadow: "0 0 5px rgba(255,220,90,0.45)",
              pointerEvents: "none",
            }}
          />
        )}
        {stops.map((stop) => {
          const leftPct = Math.max(0, Math.min(1, stop.t)) * 100;
          const isSelected = selectedId === stop.id;
          return (
            <div
              key={stop.id}
              onPointerDown={(e) => onPinPointerDown(e, stop)}
              onPointerUp={(e) => onPinPointerUp(e, stop)}
              style={{
                position: "absolute",
                left: `calc(${leftPct}% - ${PIN_SIZE / 2}px)`,
                top: (TRACK_HEIGHT - PIN_SIZE) / 2,
                width: PIN_SIZE,
                height: PIN_SIZE,
                borderRadius: PIN_SIZE,
                background: stop.color,
                border: `2px solid ${isSelected ? "#ffffff" : "rgba(255,255,255,0.55)"}`,
                boxShadow: `0 0 0 ${isSelected ? 3 : 1}px ${
                  isSelected ? "rgba(255,220,90,0.55)" : "rgba(0,0,0,0.5)"
                }`,
                boxSizing: "border-box",
                cursor: "grab",
                touchAction: "none",
                zIndex: isSelected ? 2 : 1,
              }}
              title={`${label} · ${(stop.t * 100).toFixed(0)}%`}
            />
          );
        })}
      </div>
    </div>
  );
}

function PaletteStopEditor({
  title,
  stop,
  onChange,
  onDelete,
  onClose,
}: {
  title: string;
  stop: LightningColorStop;
  onChange: (patch: Partial<LightningColorStop>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        marginTop: 4,
        padding: 8,
        borderRadius: 8,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          fontSize: 11,
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 12,
              background: stop.color,
              border: "1px solid rgba(255,255,255,0.35)",
            }}
          />
          <strong>{title}</strong>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={onDelete}
            style={{
              background: "rgba(255,90,90,0.14)",
              color: "inherit",
              border: "1px solid rgba(255,90,90,0.35)",
              borderRadius: 6,
              padding: "2px 8px",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Delete
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.06)",
              color: "inherit",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 6,
              padding: "2px 8px",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Close
          </button>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto auto",
          columnGap: 12,
          rowGap: 8,
          alignItems: "center",
          fontSize: 11,
        }}
      >
        <label style={{ opacity: 0.75 }}>pos</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={stop.t}
          onChange={(e) =>
            onChange({ t: Math.max(0, Math.min(1, parseFloat(e.target.value))) })
          }
          style={{ width: "100%" }}
        />
        <label style={{ opacity: 0.75 }}>color</label>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="color"
            value={stop.color}
            onChange={(e) => onChange({ color: e.target.value })}
            style={{
              width: 28,
              height: 22,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 4,
              padding: 0,
              cursor: "pointer",
            }}
          />
          <input
            type="text"
            value={stop.color}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange({ color: v });
            }}
            style={{
              background: "rgba(0,0,0,0.35)",
              color: "inherit",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 4,
              padding: "1px 4px",
              width: 72,
              fontSize: 11,
              fontFamily: "ui-monospace, monospace",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function makeKfId(): string {
  return `kf-${Math.random().toString(36).slice(2, 8)}`;
}

function KeyframeEditor({
  keyframes,
  selectedId,
  plotChannel,
  plotLabel,
  playheadU,
  activeStartHour,
  activeEndHour,
  periods,
  onSelect,
  onChange,
}: {
  keyframes: LightningKeyframe[];
  selectedId: string | null;
  plotChannel: LightningPlotChannel;
  plotLabel: string;
  /** Current sky progress through the active window, or null if outside. */
  playheadU: number | null;
  activeStartHour: number;
  activeEndHour: number;
  periods: DayPeriod[];
  onSelect: (id: string) => void;
  onChange: (next: LightningKeyframe[]) => void;
}) {
  const sorted = useMemo(
    () => [...keyframes].sort((a, b) => a.t - b.t),
    [keyframes],
  );
  const selected =
    sorted.find((k) => k.id === selectedId) ?? sorted[0] ?? null;

  const periodSpans = useMemo(
    () =>
      periodsCrossingActiveWindow(periods, activeStartHour, activeEndHour),
    [periods, activeStartHour, activeEndHour],
  );

  const W = 520;
  const H = 64;
  const PAD = 4;
  const plotInnerW = W - PAD * 2;
  const ymax = Math.max(1e-6, plotChannelMax(plotChannel));
  const rangeChannel = isRangePlotChannel(plotChannel);
  const paths = useMemo(() => {
    const samples = 48;
    const midPts: string[] = [];
    const loPts: string[] = [];
    const hiPts: string[] = [];
    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      const x = PAD + u * plotInnerW;
      if (rangeChannel) {
        const pair = samplePlotChannelRange(sorted, u, plotChannel);
        const lo = pair?.lo ?? 0;
        const hi = pair?.hi ?? 0;
        loPts.push(
          `${x.toFixed(1)},${(PAD + (1 - Math.min(ymax, lo) / ymax) * (H - PAD * 2)).toFixed(1)}`,
        );
        hiPts.push(
          `${x.toFixed(1)},${(PAD + (1 - Math.min(ymax, hi) / ymax) * (H - PAD * 2)).toFixed(1)}`,
        );
      } else {
        const v = samplePlotChannel(sorted, u, plotChannel);
        midPts.push(
          `${x.toFixed(1)},${(PAD + (1 - Math.min(ymax, v) / ymax) * (H - PAD * 2)).toFixed(1)}`,
        );
      }
    }
    return {
      mid: midPts.length ? `M${midPts.join(" L")}` : "",
      lo: loPts.length ? `M${loPts.join(" L")}` : "",
      hi: hiPts.length ? `M${hiPts.join(" L")}` : "",
    };
  }, [sorted, plotChannel, ymax, rangeChannel, plotInnerW]);

  const addKey = () => {
    const base = selected?.values ?? sampleLightningKeyframe(sorted, 0.5);
    const t = selected ? Math.min(1, selected.t + 0.1) : 0.5;
    const id = makeKfId();
    onChange([...keyframes, { id, t, values: cloneAnim(base) }]);
    onSelect(id);
  };

  const removeKey = () => {
    if (keyframes.length <= 2 || !selected) return;
    const next = keyframes.filter((k) => k.id !== selected.id);
    onChange(next);
    onSelect(next[0]?.id ?? null);
  };

  const setSelectedT = (t: number) => {
    if (!selected) return;
    onChange(
      keyframes.map((k) =>
        k.id === selected.id ? { ...k, t: Math.max(0, Math.min(1, t)) } : k,
      ),
    );
  };

  const onPreviewClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const t = Math.max(0, Math.min(1, x));
    const values = cloneAnim(sampleLightningKeyframe(sorted, t));
    const id = makeKfId();
    onChange([...keyframes, { id, t, values }]);
    onSelect(id);
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <div style={{ fontSize: 10, opacity: 0.7 }}>
          Storm keyframes · plotting {plotLabel}
          {playheadU != null
            ? ` · now ${(playheadU * 100).toFixed(0)}%`
            : " · outside window"}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" style={miniBtn} onClick={addKey}>
            + key
          </button>
          <button
            type="button"
            style={miniBtn}
            onClick={removeKey}
            disabled={keyframes.length <= 2}
          >
            − key
          </button>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        style={{
          display: "block",
          cursor: "crosshair",
          background: "rgba(0,0,0,0.2)",
          borderRadius: 4,
        }}
        onClick={onPreviewClick}
      >
        {periodSpans.map((span, i) => {
          const x = PAD + span.u0 * plotInnerW;
          const w = Math.max(0.5, (span.u1 - span.u0) * plotInnerW);
          const label =
            w >= 28 ? span.name : w >= 14 ? span.name.slice(0, 1) : "";
          return (
            <g key={`${span.periodId}-${i}-${span.u0.toFixed(3)}`}>
              <rect
                x={x}
                y={0}
                width={w}
                height={H}
                fill={span.color}
                opacity={0.22}
              />
              <line
                x1={x}
                x2={x}
                y1={0}
                y2={H}
                stroke={span.color}
                strokeOpacity={0.55}
                strokeWidth={1}
              />
              {label && (
                <text
                  x={x + 3}
                  y={10}
                  fill="rgba(255,255,255,0.88)"
                  fontSize={7}
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                  style={{ pointerEvents: "none" }}
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
        {rangeChannel ? (
          <>
            <path
              d={paths.hi}
              fill="none"
              stroke="rgba(255,180,120,0.95)"
              strokeWidth={1.5}
            />
            <path
              d={paths.lo}
              fill="none"
              stroke="rgba(120,200,255,0.95)"
              strokeWidth={1.5}
            />
          </>
        ) : (
          <path
            d={paths.mid}
            fill="none"
            stroke="rgba(180,210,255,0.95)"
            strokeWidth={1.5}
          />
        )}
        {playheadU != null && (
          <line
            x1={PAD + playheadU * plotInnerW}
            x2={PAD + playheadU * plotInnerW}
            y1={2}
            y2={H - 2}
            stroke="rgba(250,204,21,0.95)"
            strokeWidth={1.5}
            strokeDasharray="3 2"
          />
        )}
        {sorted.map((k) => {
          const x = PAD + k.t * plotInnerW;
          const sel = selected?.id === k.id;
          if (rangeChannel) {
            const pair = samplePlotChannelRange([k], k.t, plotChannel);
            const lo = pair?.lo ?? 0;
            const hi = pair?.hi ?? 0;
            const yLo = PAD + (1 - Math.min(ymax, lo) / ymax) * (H - PAD * 2);
            const yHi = PAD + (1 - Math.min(ymax, hi) / ymax) * (H - PAD * 2);
            return (
              <g key={k.id}>
                <line
                  x1={x}
                  x2={x}
                  y1={yHi}
                  y2={yLo}
                  stroke={
                    sel ? "rgba(255,220,140,0.9)" : "rgba(200,220,255,0.45)"
                  }
                  strokeWidth={sel ? 2 : 1}
                />
                <circle
                  cx={x}
                  cy={yHi}
                  r={sel ? 3.5 : 2.5}
                  fill={sel ? "rgba(255,180,120,1)" : "rgba(255,180,120,0.85)"}
                  stroke="rgba(0,0,0,0.5)"
                  strokeWidth={1}
                />
                <circle
                  cx={x}
                  cy={yLo}
                  r={sel ? 3.5 : 2.5}
                  fill={sel ? "rgba(120,200,255,1)" : "rgba(120,200,255,0.85)"}
                  stroke="rgba(0,0,0,0.5)"
                  strokeWidth={1}
                />
              </g>
            );
          }
          const v = samplePlotChannel([k], k.t, plotChannel);
          const y = PAD + (1 - Math.min(ymax, v) / ymax) * (H - PAD * 2);
          return (
            <circle
              key={k.id}
              cx={x}
              cy={y}
              r={sel ? 4 : 3}
              fill={sel ? "rgba(255,220,140,1)" : "rgba(200,220,255,0.9)"}
              stroke="rgba(0,0,0,0.5)"
              strokeWidth={1}
            />
          );
        })}
      </svg>
      {periodSpans.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginTop: 4,
            fontSize: 9,
            opacity: 0.85,
          }}
        >
          {periodSpans.map((span, i) => (
            <span
              key={`leg-${span.periodId}-${i}-${span.u0.toFixed(3)}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: span.color,
                  display: "inline-block",
                }}
              />
              {span.name}
            </span>
          ))}
        </div>
      )}
      {rangeChannel && (
        <div
          style={{
            display: "flex",
            gap: 10,
            fontSize: 9,
            opacity: 0.7,
            marginTop: 2,
          }}
        >
          <span style={{ color: "rgba(255,180,120,0.95)" }}>upper</span>
          <span style={{ color: "rgba(120,200,255,0.95)" }}>lower</span>
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          marginTop: 4,
          marginBottom: 4,
        }}
      >
        {sorted.map((k, i) => (
          <button
            key={k.id}
            type="button"
            onClick={() => onSelect(k.id)}
            style={{
              ...miniBtn,
              background:
                selected?.id === k.id
                  ? "rgba(250,204,21,0.25)"
                  : miniBtn.background,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {i + 1}: {(k.t * 100).toFixed(0)}%
          </button>
        ))}
      </div>
      {selected && (
        <SliderRow
          label="Phase"
          value={selected.t}
          min={0}
          max={1}
          step={0.01}
          onChange={setSelectedT}
          formatValue={(v) => `${(v * 100).toFixed(0)}%`}
        />
      )}
    </div>
  );
}

function AudioSection({
  lightning,
  anim,
  plotChannel,
  setPlotChannel,
  upd,
  patchAnim,
}: {
  lightning: LightningParams;
  anim: LightningAnimParams;
  plotChannel: LightningPlotChannel;
  setPlotChannel: (c: LightningPlotChannel) => void;
  upd: (patch: Partial<LightningParams>) => void;
  patchAnim: (patch: Partial<LightningAnimParams>) => void;
}) {
  const bgInputRef = useRef<HTMLInputElement | null>(null);
  const strikeInputRef = useRef<HTMLInputElement | null>(null);

  const onBgFile = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const sample = await ingestFile(files[0]);
    if (sample) {
      if (lightning.backgroundSample) {
        void deleteSampleBlob(lightning.backgroundSample.id);
      }
      upd({ backgroundSample: sample });
    }
    if (bgInputRef.current) bgInputRef.current.value = "";
  };

  const onStrikeFile = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const sample = await ingestFile(files[0]);
    if (sample) {
      if (lightning.strikeSample) {
        void deleteSampleBlob(lightning.strikeSample.id);
      }
      upd({ strikeSample: sample });
    }
    if (strikeInputRef.current) strikeInputRef.current.value = "";
  };

  const clearBackground = () => {
    if (lightning.backgroundSample) {
      void deleteSampleBlob(lightning.backgroundSample.id);
    }
    upd({ backgroundSample: null });
  };

  const clearStrike = () => {
    if (lightning.strikeSample) {
      void deleteSampleBlob(lightning.strikeSample.id);
    }
    upd({ strikeSample: null });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 2 }}>Audio</div>
      <SliderRow
        label={`Bolt gain${KF}`}
        labelActive={plotChannel === "boltGain"}
        onLabelClick={() => setPlotChannel("boltGain")}
        value={anim.boltGain}
        min={0}
        max={3}
        step={0.01}
        onChange={(v) => patchAnim({ boltGain: v })}
      />
      <SliderRow
        label={`BG gain${KF}`}
        labelActive={plotChannel === "backgroundGain"}
        onLabelClick={() => setPlotChannel("backgroundGain")}
        value={anim.backgroundGain}
        min={0}
        max={3}
        step={0.01}
        onChange={(v) => patchAnim({ backgroundGain: v })}
      />
      <SliderRow
        label="Pitch ±¢"
        value={lightning.boltPitchJitterCents}
        min={0}
        max={1200}
        step={5}
        onChange={(v) => upd({ boltPitchJitterCents: v })}
        formatValue={(v) => `±${v.toFixed(0)}¢`}
      />
      <SliderRow
        label={`Thunder delay${KF}`}
        labelActive={plotChannel === "thunderDelay"}
        onLabelClick={() => setPlotChannel("thunderDelay")}
        value={anim.thunderDelayMs}
        min={0}
        max={2000}
        step={10}
        onChange={(v) => patchAnim({ thunderDelayMs: v })}
        formatValue={(v) => `${v.toFixed(0)} ms`}
      />
      <SliderRow
        label={`Pan${KF}`}
        labelActive={plotChannel === "pan"}
        onLabelClick={() => setPlotChannel("pan")}
        value={anim.pan}
        min={-1}
        max={1}
        step={0.01}
        onChange={(v) => patchAnim({ pan: v })}
        formatValue={(v) =>
          Math.abs(v) < 0.02
            ? "C"
            : v < 0
              ? `L ${(-v * 100).toFixed(0)}`
              : `R ${(v * 100).toFixed(0)}`
        }
      />

      <div
        style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}
        title="Plays for cloud-to-ground strikes (Strike / min)"
      >
        <span style={{ fontSize: 11, opacity: 0.85, flex: 1 }}>
          Strike sound
          {lightning.strikeSample
            ? `: ${lightning.strikeSample.name}`
            : " (none)"}
        </span>
        <button
          type="button"
          style={miniBtn}
          onClick={() => strikeInputRef.current?.click()}
        >
          {lightning.strikeSample ? "replace" : "+ upload"}
        </button>
        {lightning.strikeSample && (
          <button type="button" style={miniBtn} onClick={clearStrike}>
            clear
          </button>
        )}
        <input
          ref={strikeInputRef}
          type="file"
          accept="audio/*"
          style={{ display: "none" }}
          onChange={(e) => onStrikeFile(e.target.files)}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
        <span style={{ fontSize: 11, opacity: 0.85, flex: 1 }}>
          Background
          {lightning.backgroundSample
            ? `: ${lightning.backgroundSample.name}`
            : " (none)"}
        </span>
        <button
          type="button"
          style={miniBtn}
          onClick={() => bgInputRef.current?.click()}
        >
          {lightning.backgroundSample ? "replace" : "+ upload"}
        </button>
        {lightning.backgroundSample && (
          <button type="button" style={miniBtn} onClick={clearBackground}>
            clear
          </button>
        )}
        <input
          ref={bgInputRef}
          type="file"
          accept="audio/*"
          style={{ display: "none" }}
          onChange={(e) => onBgFile(e.target.files)}
        />
      </div>
    </div>
  );
}

function BoltSamplesColumn({
  lightning,
  upd,
}: {
  lightning: LightningParams;
  upd: (patch: Partial<LightningParams>) => void;
}) {
  const boltInputRef = useRef<HTMLInputElement | null>(null);

  const onBoltFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: LightningSample[] = [];
    for (const f of Array.from(files)) {
      const sample = await ingestFile(f);
      if (sample) added.push(sample);
    }
    if (added.length > 0) {
      upd({ boltSamples: [...lightning.boltSamples, ...added] });
    }
    if (boltInputRef.current) boltInputRef.current.value = "";
  };

  const removeBolt = (id: string) => {
    void deleteSampleBlob(id);
    upd({ boltSamples: lightning.boltSamples.filter((s) => s.id !== id) });
  };

  const patchBolt = (id: string, patch: Partial<LightningSample>) => {
    upd({
      boltSamples: lightning.boltSamples.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      ),
    });
  };

  const toggleIntensity = (id: string, tag: BoltIntensityTag) => {
    const sample = lightning.boltSamples.find((s) => s.id === id);
    if (!sample) return;
    const cur = sample.intensityTags ?? [];
    const next = cur.includes(tag)
      ? cur.filter((t) => t !== tag)
      : [...cur, tag];
    patchBolt(id, { intensityTags: next });
  };

  const toggleLength = (id: string, tag: BoltLengthTag) => {
    const sample = lightning.boltSamples.find((s) => s.id === id);
    if (!sample) return;
    const cur = sample.lengthTags ?? [];
    const next = cur.includes(tag)
      ? cur.filter((t) => t !== tag)
      : [...cur, tag];
    patchBolt(id, { lengthTags: next });
  };

  return (
    <div
      style={{
        ...boltColStyle,
        borderLeft: "none",
        paddingLeft: 0,
        height: "auto",
        minHeight: 0,
        flex: 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, opacity: 0.7, flex: 1 }}>
          Cloud bolts ({lightning.boltSamples.length})
        </span>
        <button
          type="button"
          style={miniBtn}
          onClick={() => boltInputRef.current?.click()}
        >
          + upload
        </button>
        <input
          ref={boltInputRef}
          type="file"
          accept="audio/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => onBoltFiles(e.target.files)}
        />
      </div>
      <ul
        style={boltListStyle}
        title={
          "Tick intensity (L/M/H) and length (S/M/L) bands each clip suits. " +
          "Flashes pick a matching sound from strike strength + flash duration. " +
          "Untagged clips are fallback-only."
        }
      >
        {lightning.boltSamples.length === 0 ? (
          <li
            style={{
              padding: "8px 6px",
              fontSize: 10,
              opacity: 0.45,
            }}
          >
            No clips yet
          </li>
        ) : (
          lightning.boltSamples.map((s) => (
            <li
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 5px",
                fontSize: 10,
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                minHeight: 22,
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={s.name}
              >
                {s.name}
              </span>
              <span
                style={tagGroupStyle}
                title="Intensity: low / medium / high"
              >
                {BOLT_INTENSITY_TAGS.map((tag) => (
                  <TagCheck
                    key={tag}
                    label={tag[0]!.toUpperCase()}
                    title={tag}
                    checked={(s.intensityTags ?? []).includes(tag)}
                    onChange={() => toggleIntensity(s.id, tag)}
                  />
                ))}
              </span>
              <span style={tagGroupStyle} title="Length: short / medium / long">
                {BOLT_LENGTH_TAGS.map((tag) => (
                  <TagCheck
                    key={tag}
                    label={tag[0]!.toUpperCase()}
                    title={tag}
                    checked={(s.lengthTags ?? []).includes(tag)}
                    onChange={() => toggleLength(s.id, tag)}
                  />
                ))}
              </span>
              {typeof s.durationSec === "number" && (
                <span
                  style={{
                    opacity: 0.45,
                    fontVariantNumeric: "tabular-nums",
                    fontSize: 9,
                    minWidth: 28,
                    textAlign: "right",
                  }}
                >
                  {s.durationSec.toFixed(1)}s
                </span>
              )}
              <button
                type="button"
                style={{ ...miniBtn, padding: "0 4px", lineHeight: 1.2 }}
                onClick={() => removeBolt(s.id)}
                title="Remove"
              >
                ×
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function SpriteSamplesColumn({
  lightning,
  upd,
}: {
  lightning: LightningParams;
  upd: (patch: Partial<LightningParams>) => void;
}) {
  const spriteInputRef = useRef<HTMLInputElement | null>(null);
  const samples = lightning.spriteSamples ?? [];

  const onSpriteFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: LightningSpriteSample[] = [];
    for (const f of Array.from(files)) {
      const sample = await ingestSpriteFile(f);
      if (sample) added.push(sample);
    }
    if (added.length > 0) {
      upd({ spriteSamples: [...samples, ...added] });
    }
    if (spriteInputRef.current) spriteInputRef.current.value = "";
  };

  const removeSprite = (id: string) => {
    invalidateSpriteImage(id);
    void deleteSampleBlob(id);
    upd({ spriteSamples: samples.filter((s) => s.id !== id) });
  };

  return (
    <div
      style={{
        ...boltColStyle,
        borderLeft: "none",
        paddingLeft: 0,
        height: "auto",
        minHeight: 0,
        flex: 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, opacity: 0.7, flex: 1 }}>
          Sprites ({samples.length})
        </span>
        <button
          type="button"
          style={miniBtn}
          onClick={() => spriteInputRef.current?.click()}
        >
          + upload
        </button>
        <input
          ref={spriteInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => onSpriteFiles(e.target.files)}
        />
      </div>
      <div style={{ fontSize: 9, opacity: 0.5, marginBottom: 2 }}>
        Each trigger picks a random image and projects it ±X/Y/Z through the
        cloud with a short strobe.
      </div>
      <ul style={boltListStyle}>
        {samples.length === 0 ? (
          <li
            style={{
              padding: "8px 6px",
              fontSize: 10,
              opacity: 0.45,
            }}
          >
            No images yet
          </li>
        ) : (
          samples.map((s) => (
            <li
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 5px",
                fontSize: 10,
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                minHeight: 22,
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={s.name}
              >
                {s.name}
              </span>
              {typeof s.width === "number" && typeof s.height === "number" && (
                <span
                  style={{
                    opacity: 0.45,
                    fontVariantNumeric: "tabular-nums",
                    fontSize: 9,
                    minWidth: 48,
                    textAlign: "right",
                  }}
                >
                  {s.width}×{s.height}
                </span>
              )}
              <button
                type="button"
                style={{ ...miniBtn, padding: "0 4px", lineHeight: 1.2 }}
                onClick={() => removeSprite(s.id)}
                title="Remove"
              >
                ×
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

async function ingestFile(file: File): Promise<LightningSample | null> {
  try {
    const id = `ln-${Math.random().toString(36).slice(2, 10)}`;
    const arr = await file.arrayBuffer();
    await putSampleBlob(id, new Blob([arr], { type: file.type || "audio/*" }));
    let durationSec: number | undefined;
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AC) {
        const ctx = new AC();
        const buf = await ctx.decodeAudioData(arr.slice(0));
        durationSec = buf.duration;
        void ctx.close();
      }
    } catch {
      // Duration is optional.
    }
    return {
      id,
      name: file.name,
      durationSec,
      intensityTags: [],
      lengthTags: [],
    };
  } catch (err) {
    console.warn("[lightning] file ingest failed", err);
    return null;
  }
}

async function ingestSpriteFile(
  file: File,
): Promise<LightningSpriteSample | null> {
  try {
    if (!file.type.startsWith("image/")) {
      console.warn("[lightning] sprite rejected (not an image)", file.name);
      return null;
    }
    const id = `ls-${Math.random().toString(36).slice(2, 10)}`;
    const arr = await file.arrayBuffer();
    const blob = new Blob([arr], { type: file.type || "image/*" });
    await putSampleBlob(id, blob);
    let width: number | undefined;
    let height: number | undefined;
    try {
      const bitmap = await createImageBitmap(blob);
      width = bitmap.width;
      height = bitmap.height;
      bitmap.close();
    } catch {
      // Dimensions optional.
    }
    return {
      id,
      name: file.name,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    };
  } catch (err) {
    console.warn("[lightning] sprite ingest failed", err);
    return null;
  }
}

function labelClickStyle(active: boolean): React.CSSProperties {
  return {
    cursor: "pointer",
    textDecoration: active ? "underline" : "none",
    color: active ? "rgba(250,204,21,0.95)" : "inherit",
  };
}

function RangeRow({
  label,
  labelActive,
  onLabelClick,
  min,
  max,
  step,
  low,
  high,
  onChange,
  format,
}: {
  label: string;
  labelActive?: boolean;
  onLabelClick?: () => void;
  min: number;
  max: number;
  step: number;
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
  format?: (low: number, high: number) => string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
      <span
        style={{
          width: 92,
          opacity: 0.85,
          ...labelClickStyle(Boolean(labelActive)),
        }}
        onClick={onLabelClick}
        title={onLabelClick ? "Show this parameter on the keyframe plot" : undefined}
      >
        {label}
      </span>
      <RangeSlider
        min={min}
        max={max}
        step={step}
        value={[low, high]}
        onChange={([lo, hi]) => onChange(lo, hi)}
      />
      <span
        style={{
          width: 90,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {format ? format(low, high) : `${low.toFixed(2)}–${high.toFixed(2)}`}
      </span>
    </div>
  );
}

function SliderRow({
  label,
  labelActive,
  onLabelClick,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
}: {
  label: string;
  labelActive?: boolean;
  onLabelClick?: () => void;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
      <span
        style={{
          width: 92,
          opacity: 0.85,
          ...labelClickStyle(Boolean(labelActive)),
        }}
        onClick={onLabelClick}
        title={onLabelClick ? "Show this parameter on the keyframe plot" : undefined}
      >
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1 }}
      />
      <span
        style={{
          width: 46,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatValue ? formatValue(value) : value.toFixed(2)}
      </span>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 60,
  right: 12,
  zIndex: 15,
  width: 920,
  background: "rgba(10, 12, 20, 0.82)",
  backdropFilter: "blur(8px)",
  color: "rgba(207,214,230,0.95)",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  // Cap to space above the bottom anchor so growth never pushes the header
  // off-screen; body scrolls inside instead.
  maxHeight: "calc(100vh - 72px)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const panelScrollStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  marginTop: 6,
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "contain",
};

const threeColStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1.15fr",
  gap: 12,
  alignItems: "stretch",
};

const colStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  minWidth: 0,
};

const boltColStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  minWidth: 0,
  // Don't let clip list drive row height — match sibling columns and scroll.
  height: 0,
  minHeight: "100%",
  overflow: "hidden",
  borderLeft: "1px solid rgba(255,255,255,0.08)",
  paddingLeft: 10,
};

const boltListStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "contain",
  overflowAnchor: "none",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 4,
};

const titleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.3,
};

const inlineLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 11,
  opacity: 0.9,
};

const miniBtn: React.CSSProperties = {
  fontSize: 10,
  padding: "2px 6px",
  borderRadius: 4,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)",
  color: "inherit",
  cursor: "pointer",
};

const tagGroupStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 1,
  flexShrink: 0,
  padding: "0 2px",
  borderLeft: "1px solid rgba(255,255,255,0.08)",
};

function TagCheck({
  label,
  title,
  checked,
  onChange,
}: {
  label: string;
  title: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 14,
        height: 14,
        fontSize: 9,
        fontWeight: 600,
        lineHeight: 1,
        cursor: "pointer",
        userSelect: "none",
        borderRadius: 2,
        opacity: checked ? 1 : 0.35,
        background: checked ? "rgba(255,255,255,0.14)" : "transparent",
        color: "inherit",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
      />
      {label}
    </label>
  );
}
