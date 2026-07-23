import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  breathLevelAt,
  sampleBreathAt,
  sampleParticipantBreath,
  seekBreathClock,
  tickBreathClock,
} from "../lighting/breath";
import {
  MAX_BREATH_PARTICIPANTS,
  useSimStore,
  type BreathParticipant,
} from "../state";
import { useDraggable } from "./useDraggable";
import {
  clearOscBreathHistory,
  getOscBreathBinary,
  getOscBreathHistory,
  getOscBreathValueAt,
  getOscRelayStatus,
  isOscBreathConnected,
  subscribeOscBreath,
} from "../breath/oscBreathClient";

const PRESET_COLORS = [
  "#77d5ff",
  "#9bff9b",
  "#ffc878",
  "#f3a6ff",
  "#ff8f8f",
  "#90b1ff",
];

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function makeParticipantId(): string {
  return `participant-${Math.random().toString(36).slice(2, 7)}-${Date.now().toString(36)}`;
}

function fmtS(v: number): string {
  return `${v.toFixed(1)}s`;
}

const PARAM_HELP = {
  inhaleSeconds:
    "Duration of the inhale ramp. Longer values make the pull-in phase slower and smoother.",
  holdPeakSeconds:
    "How long breath stays at full inhale before exhaling begins.",
  exhaleSeconds:
    "Duration of the exhale ramp. Longer exhales spawn longer / wider travelling waves.",
  holdTroughSeconds:
    "How long breath rests at the trough before the next inhale starts.",
  horizonDistance:
    "Vertical offset of participants from the horizon plane. Positive raises them above the plane, negative lowers them.",
  cloudDistance:
    "Radial distance from the cloud center out to the participants on the horizon circle.",
  waveWidth:
    "Lateral half-size of the breath volume, across the travel path (metres).",
  waveHeight:
    "Vertical half-size of the breath volume (metres).",
  waveDepth:
    "Half-size along the travel axis — toward / away from the participant (metres).",
  waveSpeed:
    "How fast the exhale wave travels from the participant through the cloud (m/s).",
  falloff:
    "How quickly influence drops from the wave center. Higher means sharper, lower means broader.",
  noiseScale:
    "Size of fog features inside the breath volume. Higher = finer / smaller blobs.",
  noiseAmount:
    "How much 3D fog density shapes intensity. 0 = smooth volume only, 1 = fully noisy.",
  noiseContrast:
    "Separates dense fog from empty pockets. Higher = sharper cloudy clumps.",
  edgeNoise:
    "Makes the breath-volume silhouette ragged near the surface only. Does not enlarge or brighten the core. Higher = chunkier scallops.",
  rimThickness:
    "How thick the colour rim is around the outside of the breath volume (metres).",
  rimAmount:
    "How strongly LEDs in the rim shift toward the participant colour. 0 = off, 1 = full tint.",
  rimArc:
    "Angular width of the rim arc in degrees. Midpoint faces away from the participant. 360 = full ring, smaller = a crescent on the far side.",
  breathTimeMix:
    "Blend in Breath + Time of Day mode. 0 = time-of-day only, 1 = breath-only.",
};

export function BreathOscillator({ visible: mounted = true }: { visible?: boolean } = {}) {
  const breath = useSimStore((s) => s.breath);
  const setBreath = useSimStore((s) => s.setBreath);
  const [nowMs, setNowMs] = useState(() => performance.now());
  const [wallNowMs, setWallNowMs] = useState(() => performance.now());
  const [visible, setVisible] = useState(true);
  const [oscTick, setOscTick] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Keep below the fixed SkyTimeline (top: 56 + ~arc/tracks).
  const SKY_TIMELINE_CLEARANCE = 300;
  const { pos, handleProps } = useDraggable(panelRef, {
    minTop: SKY_TIMELINE_CLEARANCE,
  });

  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      setNowMs(tickBreathClock(t, useSimStore.getState().breath.paused));
      setWallNowMs(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    return subscribeOscBreath(() => setOscTick((n) => n + 1));
  }, []);
  // Keep oscTick referenced so React tracks OSC-driven re-renders.
  void oscTick;
  const cycleSeconds =
    breath.inhaleSeconds +
    breath.holdPeakSeconds +
    breath.exhaleSeconds +
    breath.holdTroughSeconds;
  const cycleMs = Math.max(1, cycleSeconds * 1000);
  const leadProgress = (nowMs % cycleMs) / cycleMs;
  const sample = sampleBreathAt(breath, nowMs);
  const currentLevel = sample.level;
  const inhaleLevel = sample.inhaleIntensity;
  const exhaleLevel = sample.exhaleIntensity;

  const segmentPercents = useMemo(() => {
    if (cycleSeconds <= 1e-6) {
      return { inhale: 0, holdPeak: 0, exhale: 0, holdTrough: 100 };
    }
    return {
      inhale: (breath.inhaleSeconds / cycleSeconds) * 100,
      holdPeak: (breath.holdPeakSeconds / cycleSeconds) * 100,
      exhale: (breath.exhaleSeconds / cycleSeconds) * 100,
      holdTrough: (breath.holdTroughSeconds / cycleSeconds) * 100,
    };
  }, [
    breath.exhaleSeconds,
    breath.holdPeakSeconds,
    breath.holdTroughSeconds,
    breath.inhaleSeconds,
    cycleSeconds,
  ]);

  const addParticipant = () => {
    if (breath.participants.length >= MAX_BREATH_PARTICIPANTS) return;
    const nextIndex = breath.participants.length;
    const newP: BreathParticipant = {
      id: makeParticipantId(),
      color: PRESET_COLORS[nextIndex % PRESET_COLORS.length],
      enabled: true,
      azimuthDeg: (nextIndex * 90) % 360,
      phaseOffset: (nextIndex * 0.17) % 1,
    };
    setBreath({ participants: [...breath.participants, newP] });
  };

  const updateParticipant = (id: string, patch: Partial<BreathParticipant>) => {
    setBreath({
      participants: breath.participants.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    });
  };

  const removeParticipant = (id: string) => {
    if (breath.participants.length <= 1) return;
    setBreath({
      participants: breath.participants.filter((p) => p.id !== id),
    });
  };

  const baseStyle: React.CSSProperties = {
    position: "fixed",
    left: pos ? pos.left : "50%",
    top: pos ? pos.top : undefined,
    bottom: pos ? undefined : 72,
    transform: pos ? undefined : "translateX(-50%)",
    width: "min(820px, calc(100vw - 390px))",
    maxHeight: `calc(100vh - ${SKY_TIMELINE_CLEARANCE}px - 64px)`,
    overflowY: "auto",
    zIndex: 9,
    pointerEvents: "auto",
    background: "rgba(10, 12, 20, 0.72)",
    backdropFilter: "blur(8px)",
    borderRadius: 12,
    color: "rgba(207,214,230,0.95)",
    boxShadow: "0 1px 0 rgba(255,255,255,0.05) inset",
    padding: "10px 12px",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  };
  if (!mounted) return null;
  return (
    <div ref={panelRef} style={baseStyle}>
      <div
        onPointerDown={handleProps.onPointerDown}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 8,
          fontSize: 11,
          cursor: "move",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => setVisible((v) => !v)}
            title={visible ? "Hide panel body" : "Show panel body"}
            style={{
              background: "rgba(255,255,255,0.06)",
              color: "inherit",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 4,
              padding: "1px 6px",
              cursor: "pointer",
              fontSize: 11,
              lineHeight: 1,
            }}
          >
            {visible ? "▾" : "▸"}
          </button>
          <span style={{ textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.7 }}>
            Breath Oscillator
          </span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={breath.enabled}
              onChange={(e) => setBreath({ enabled: e.target.checked })}
            />
            enabled
          </label>
          <label
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            title="OSC breath-out always spawns travelling spheroids. Internal also runs the simulated oscillator when selected."
          >
            trigger
            <select
              value={breath.triggerSource ?? "internal"}
              onChange={(e) =>
                setBreath({
                  triggerSource: e.target.value === "osc" ? "osc" : "internal",
                })
              }
              style={{
                background: "rgba(0,0,0,0.35)",
                color: "inherit",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 4,
                padding: "1px 4px",
                fontSize: 11,
              }}
            >
              <option value="internal">Internal</option>
              <option value="osc">OSC</option>
            </select>
          </label>
          {breath.triggerSource === "osc" && (
            <span
              style={{
                fontSize: 10,
                opacity: 0.75,
                color: isOscBreathConnected()
                  ? "rgba(140,220,160,0.95)"
                  : "rgba(255,180,120,0.95)",
              }}
              title="Relay must be running (npm run dev) to receive UDP OSC on port 999"
            >
              {(() => {
                if (!isOscBreathConnected()) return "relay offline";
                const st = getOscRelayStatus();
                if (!st || st.packets === 0) return "relay · udp 999 · no packets yet";
                const age =
                  st.lastAtMs > 0
                    ? `${((Date.now() - st.lastAtMs) / 1000).toFixed(1)}s ago`
                    : "";
                if (!st.lastMatched) {
                  return `udp ${st.packets} · unmatched ${st.lastAddress || "?"} ${age}`;
                }
                return `udp ${st.packets} · ok ${st.matched} · ${st.lastAddress}=${st.lastValue} ${age}`;
              })()}
            </span>
          )}
          <button
            onClick={() => setBreath({ paused: !breath.paused })}
            title={
              breath.paused
                ? "Resume the breath oscillator and travelling waves"
                : "Pause the oscillator so you can inspect the cloud visualization"
            }
            style={{
              background: breath.paused
                ? "rgba(250, 204, 21, 0.22)"
                : "rgba(255,255,255,0.06)",
              color: "inherit",
              border: `1px solid ${
                breath.paused
                  ? "rgba(250, 204, 21, 0.5)"
                  : "rgba(255,255,255,0.15)"
              }`,
              borderRadius: 6,
              padding: "3px 10px",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            {breath.paused ? "▶ Resume" : "❚❚ Pause"}
          </button>
          {visible && (
            <span style={{ opacity: 0.75 }}>
              cycle {fmtS(cycleSeconds)} · level {currentLevel.toFixed(2)} · exhale{" "}
              {exhaleLevel.toFixed(2)} · inhale {inhaleLevel.toFixed(2)} · mode{" "}
              {sample.phase}
            </span>
          )}
        </div>
        <button
          onClick={addParticipant}
          disabled={breath.participants.length >= MAX_BREATH_PARTICIPANTS}
          style={{
            background: "rgba(255,255,255,0.06)",
            color: "inherit",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6,
            padding: "3px 10px",
            cursor:
              breath.participants.length >= MAX_BREATH_PARTICIPANTS
                ? "not-allowed"
                : "pointer",
            fontSize: 11,
            opacity: breath.participants.length >= MAX_BREATH_PARTICIPANTS ? 0.5 : 1,
          }}
          title={
            breath.participants.length >= MAX_BREATH_PARTICIPANTS
              ? `Maximum ${MAX_BREATH_PARTICIPANTS} participants`
              : "Add participant on the horizon"
          }
        >
          + add participant
        </button>
      </div>

      {visible && (
        <>
          <BreathCurve
            breath={breath}
            cycleSeconds={cycleSeconds}
            leadProgress={leadProgress}
            nowMs={nowMs}
            onSeek={(progress01) => {
              const cycleMsLocal = Math.max(1, cycleSeconds * 1000);
              seekBreathClock(clamp01(progress01) * cycleMsLocal);
              setNowMs(clamp01(progress01) * cycleMsLocal);
              if (!breath.paused) setBreath({ paused: true });
            }}
          />

          {breath.triggerSource === "osc" && (
            <OscBinaryTimeline
              participants={breath.participants}
              wallNowMs={wallNowMs}
            />
          )}

          <div style={{ display: "flex", gap: 6, marginTop: 8, fontSize: 10 }}>
            <SegmentPill
              label={`inhale ${fmtS(breath.inhaleSeconds)}`}
              width={segmentPercents.inhale}
              color="rgba(116, 201, 255, 0.45)"
            />
            <SegmentPill
              label={`hold peak ${fmtS(breath.holdPeakSeconds)}`}
              width={segmentPercents.holdPeak}
              color="rgba(180, 212, 255, 0.35)"
            />
            <SegmentPill
              label={`exhale ${fmtS(breath.exhaleSeconds)}`}
              width={segmentPercents.exhale}
              color="rgba(255, 170, 144, 0.42)"
            />
            <SegmentPill
              label={`hold trough ${fmtS(breath.holdTroughSeconds)}`}
              width={segmentPercents.holdTrough}
              color="rgba(170, 180, 195, 0.32)"
            />
          </div>

          <div
            style={{
              marginTop: 8,
              display: "grid",
              gap: 10,
              fontSize: 11,
            }}
          >
            <Section title="Breath Timing">
              <SliderField
                label="inhale"
                tooltip={PARAM_HELP.inhaleSeconds}
                value={breath.inhaleSeconds}
                min={0}
                max={12}
                step={0.1}
                onChange={(v) => setBreath({ inhaleSeconds: v })}
              />
              <SliderField
                label="hold peak"
                tooltip={PARAM_HELP.holdPeakSeconds}
                value={breath.holdPeakSeconds}
                min={0}
                max={8}
                step={0.1}
                onChange={(v) => setBreath({ holdPeakSeconds: v })}
              />
              <SliderField
                label="exhale"
                tooltip={PARAM_HELP.exhaleSeconds}
                value={breath.exhaleSeconds}
                min={0}
                max={14}
                step={0.1}
                onChange={(v) => setBreath({ exhaleSeconds: v })}
              />
              <SliderField
                label="hold trough"
                tooltip={PARAM_HELP.holdTroughSeconds}
                value={breath.holdTroughSeconds}
                min={0}
                max={8}
                step={0.1}
                onChange={(v) => setBreath({ holdTroughSeconds: v })}
              />
            </Section>

            <Section title="Horizon Waves">
              <SliderField
                label="horizon height"
                tooltip={PARAM_HELP.horizonDistance}
                value={breath.horizonDistance}
                min={-2}
                max={2}
                step={0.05}
                onChange={(v) => setBreath({ horizonDistance: v })}
              />
              <SliderField
                label="cloud distance"
                tooltip={PARAM_HELP.cloudDistance}
                value={breath.cloudDistance}
                min={0.5}
                max={8}
                step={0.05}
                onChange={(v) => setBreath({ cloudDistance: v })}
              />
              <SliderField
                label="wave width"
                tooltip={PARAM_HELP.waveWidth}
                value={breath.waveWidth}
                min={0}
                max={0.5}
                step={0.01}
                onChange={(v) => setBreath({ waveWidth: v })}
              />
              <SliderField
                label="wave height"
                tooltip={PARAM_HELP.waveHeight}
                value={breath.waveHeight}
                min={0}
                max={0.5}
                step={0.01}
                onChange={(v) => setBreath({ waveHeight: v })}
              />
              <SliderField
                label="wave depth"
                tooltip={PARAM_HELP.waveDepth}
                value={breath.waveDepth}
                min={0}
                max={2}
                step={0.01}
                onChange={(v) => setBreath({ waveDepth: v })}
              />
              <SliderField
                label="wave speed"
                tooltip={PARAM_HELP.waveSpeed}
                value={breath.waveSpeed}
                min={0}
                max={2}
                step={0.05}
                onChange={(v) => setBreath({ waveSpeed: v })}
              />
              <SliderField
                label="falloff"
                tooltip={PARAM_HELP.falloff}
                value={breath.falloffExponent}
                min={0}
                max={10}
                step={0.05}
                onChange={(v) => setBreath({ falloffExponent: v })}
              />
              <SliderField
                label="fog scale"
                tooltip={PARAM_HELP.noiseScale}
                value={breath.noiseScale}
                min={0.2}
                max={10}
                step={0.05}
                onChange={(v) => setBreath({ noiseScale: v })}
              />
              <SliderField
                label="fog amount"
                tooltip={PARAM_HELP.noiseAmount}
                value={breath.noiseAmount}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => setBreath({ noiseAmount: v })}
              />
              <SliderField
                label="fog contrast"
                tooltip={PARAM_HELP.noiseContrast}
                value={breath.noiseContrast}
                min={0.1}
                max={4}
                step={0.05}
                onChange={(v) => setBreath({ noiseContrast: v })}
              />
              <SliderField
                label="edge noise"
                tooltip={PARAM_HELP.edgeNoise}
                value={breath.edgeNoise}
                min={0}
                max={2}
                step={0.01}
                onChange={(v) => setBreath({ edgeNoise: v })}
              />
              <SliderField
                label="rim thickness"
                tooltip={PARAM_HELP.rimThickness}
                value={breath.rimThickness}
                min={0}
                max={0.2}
                step={0.005}
                onChange={(v) => setBreath({ rimThickness: v })}
              />
              <SliderField
                label="rim amount"
                tooltip={PARAM_HELP.rimAmount}
                value={breath.rimAmount}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => setBreath({ rimAmount: v })}
              />
              <SliderField
                label="rim arc"
                tooltip={PARAM_HELP.rimArc}
                value={breath.rimArcDegrees}
                min={0}
                max={360}
                step={1}
                onChange={(v) => setBreath({ rimArcDegrees: v })}
              />
              <SliderField
                label="breath/time mix"
                tooltip={PARAM_HELP.breathTimeMix}
                value={breath.breathVsTimeMix}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => setBreath({ breathVsTimeMix: v })}
              />
            </Section>
          </div>

          <div
            style={{
              marginTop: 8,
              display: "grid",
              gap: 6,
              maxHeight: 220,
              overflowY: "auto",
              paddingRight: 4,
            }}
          >
            {breath.participants.map((p, idx) => {
              const sampleP = sampleParticipantBreath(p, breath, nowMs);
              const oscBinary = getOscBreathBinary(idx + 1);
              return (
                <div
                  key={p.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      breath.triggerSource === "osc"
                        ? "auto auto auto 1fr 1fr auto auto auto"
                        : "auto auto auto 1fr 1fr auto auto",
                    gap: 8,
                    alignItems: "center",
                    fontSize: 11,
                    background: "rgba(255,255,255,0.04)",
                    borderRadius: 6,
                    padding: "5px 7px",
                    opacity: p.enabled ? 1 : 0.55,
                  }}
                >
                  <span style={{ opacity: 0.7, width: 20 }}>{idx + 1}</span>
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={(e) =>
                      updateParticipant(p.id, { enabled: e.target.checked })
                    }
                    title="Enable participant"
                  />
                  <input
                    type="color"
                    value={p.color}
                    onChange={(e) =>
                      updateParticipant(p.id, { color: e.target.value })
                    }
                    style={{
                      width: 30,
                      height: 20,
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: 4,
                      background: "transparent",
                      padding: 0,
                      cursor: "pointer",
                    }}
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    az
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={((p.azimuthDeg + 180) % 360) - 180}
                      onChange={(e) =>
                        updateParticipant(p.id, {
                          azimuthDeg: parseFloat(e.target.value),
                        })
                      }
                      style={{ width: "100%" }}
                    />
                    <span
                      style={{
                        minWidth: 36,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        opacity: 0.75,
                      }}
                    >
                      {p.azimuthDeg.toFixed(0)}°
                    </span>
                  </label>
                  <label
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                    title={
                      breath.triggerSource === "osc"
                        ? "Phase offset is ignored for wave spawning in OSC mode"
                        : "Offset this participant within the shared breath cycle"
                    }
                  >
                    phase
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={p.phaseOffset}
                      onChange={(e) =>
                        updateParticipant(p.id, {
                          phaseOffset: clamp01(parseFloat(e.target.value)),
                        })
                      }
                      style={{ width: "100%" }}
                      disabled={breath.triggerSource === "osc"}
                    />
                    <span
                      style={{
                        minWidth: 38,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        opacity: 0.75,
                      }}
                    >
                      {p.phaseOffset.toFixed(2)}
                    </span>
                  </label>
                  <span style={{ minWidth: 72, opacity: 0.8 }}>
                    {sampleP.phase} {sampleP.level.toFixed(2)}
                  </span>
                  {breath.triggerSource === "osc" && (
                    <span
                      title={`/breath${idx + 1}/breath_binary`}
                      style={{
                        minWidth: 52,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 600,
                        color:
                          oscBinary >= 0.5
                            ? "rgba(255,170,120,0.95)"
                            : oscBinary <= -0.5
                              ? "rgba(120,200,255,0.95)"
                              : "rgba(180,190,200,0.75)",
                      }}
                    >
                      osc {oscBinary > 0 ? "+" : ""}
                      {oscBinary.toFixed(0)}
                    </span>
                  )}
                  <button
                    onClick={() => removeParticipant(p.id)}
                    disabled={breath.participants.length <= 1}
                    style={{
                      background: "rgba(255,90,90,0.14)",
                      color: "inherit",
                      border: "1px solid rgba(255,90,90,0.35)",
                      borderRadius: 5,
                      padding: "2px 7px",
                      cursor:
                        breath.participants.length <= 1 ? "not-allowed" : "pointer",
                      fontSize: 11,
                      opacity: breath.participants.length <= 1 ? 0.5 : 1,
                    }}
                    title={
                      breath.participants.length <= 1
                        ? "Keep at least one participant"
                        : "Remove this participant"
                    }
                  >
                    remove
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function OscBinaryTimeline({
  participants,
  wallNowMs,
  windowSec = 15,
}: {
  participants: BreathParticipant[];
  wallNowMs: number;
  windowSec?: number;
}) {
  const WIDTH = 480;
  const LANE_H = 36;
  const PAD_X = 44;
  const PAD_TOP = 10;
  const PAD_BOTTOM = 18;
  const GAP = 6;
  const windowMs = windowSec * 1000;
  const lanes = Math.max(1, Math.min(MAX_BREATH_PARTICIPANTS, participants.length));
  const HEIGHT = PAD_TOP + PAD_BOTTOM + lanes * LANE_H + Math.max(0, lanes - 1) * GAP;
  const usableW = WIDTH - PAD_X - 8;
  const t0 = wallNowMs - windowMs;

  const binaryEvents = getOscBreathHistory(windowMs + 1000, "binary");

  const xAt = (tMs: number) => PAD_X + ((tMs - t0) / windowMs) * usableW;
  const yInLane = (lane: number, value: number) => {
    const top = PAD_TOP + lane * (LANE_H + GAP);
    const n = (Math.max(-1, Math.min(1, value)) + 1) / 2;
    return top + (1 - n) * (LANE_H - 8) + 4;
  };

  const stepPath = (channel: number, lane: number): string => {
    let v = getOscBreathValueAt(channel, "binary", t0);
    // If older events were pruned, hold the live value across the window.
    if (
      v === 0 &&
      !binaryEvents.some((e) => e.channel === channel && e.tMs <= t0)
    ) {
      v = getOscBreathBinary(channel);
    }
    const parts: string[] = [`M${xAt(t0).toFixed(1)},${yInLane(lane, v).toFixed(1)}`];
    for (const e of binaryEvents) {
      if (e.channel !== channel) continue;
      if (e.tMs < t0) continue;
      if (e.tMs > wallNowMs) break;
      const x = xAt(e.tMs);
      parts.push(`L${x.toFixed(1)},${yInLane(lane, v).toFixed(1)}`);
      v = e.value;
      parts.push(`L${x.toFixed(1)},${yInLane(lane, v).toFixed(1)}`);
    }
    parts.push(
      `L${xAt(wallNowMs).toFixed(1)},${yInLane(lane, v).toFixed(1)}`,
    );
    return parts.join(" ");
  };

  const tickSecs = [0, 5, 10, 15].filter((s) => s <= windowSec);

  return (
    <div
      style={{
        marginTop: 8,
        borderRadius: 8,
        background: "rgba(0,0,0,0.25)",
        border: "1px solid rgba(255,255,255,0.08)",
        padding: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 4,
          fontSize: 10,
          opacity: 0.8,
        }}
      >
        <span style={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
          OSC · last {windowSec}s
        </span>
        <button
          type="button"
          onClick={() => clearOscBreathHistory()}
          style={{
            background: "rgba(255,255,255,0.06)",
            color: "inherit",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 4,
            padding: "1px 6px",
            cursor: "pointer",
            fontSize: 10,
          }}
        >
          clear
        </button>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: Math.max(80, lanes * 42 + 28), display: "block" }}
      >
        {tickSecs.map((s) => {
          const x = xAt(wallNowMs - s * 1000);
          return (
            <g key={s}>
              <line
                x1={x}
                x2={x}
                y1={PAD_TOP}
                y2={HEIGHT - PAD_BOTTOM}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={x}
                y={HEIGHT - 4}
                fill="rgba(200,210,220,0.55)"
                fontSize={8}
                textAnchor="middle"
              >
                {s === 0 ? "now" : `−${s}s`}
              </text>
            </g>
          );
        })}
        {participants.slice(0, lanes).map((p, lane) => {
          const channel = lane + 1;
          const midY = yInLane(lane, 0);
          const top = PAD_TOP + lane * (LANE_H + GAP);
          const outY = yInLane(lane, 1);
          const inY = yInLane(lane, -1);
          return (
            <g key={p.id}>
              <rect
                x={PAD_X}
                y={top}
                width={usableW}
                height={LANE_H}
                fill="rgba(255,255,255,0.03)"
                rx={3}
              />
              <line
                x1={PAD_X}
                x2={PAD_X + usableW}
                y1={midY}
                y2={midY}
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={PAD_X - 4}
                y={outY + 3}
                fill="rgba(255,170,120,0.9)"
                fontSize={8}
                textAnchor="end"
              >
                out
              </text>
              <text
                x={PAD_X - 4}
                y={inY + 3}
                fill="rgba(120,200,255,0.9)"
                fontSize={8}
                textAnchor="end"
              >
                in
              </text>
              <path
                d={stepPath(channel, lane)}
                fill="none"
                stroke={p.color}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                opacity={p.enabled ? 0.95 : 0.35}
              />
            </g>
          );
        })}
        <line
          x1={xAt(wallNowMs)}
          x2={xAt(wallNowMs)}
          y1={PAD_TOP}
          y2={HEIGHT - PAD_BOTTOM}
          stroke="rgba(255,255,255,0.4)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function BreathCurve({
  breath,
  cycleSeconds,
  leadProgress,
  nowMs,
  onSeek,
}: {
  breath: ReturnType<typeof useSimStore.getState>["breath"];
  cycleSeconds: number;
  leadProgress: number;
  nowMs: number;
  onSeek: (progress01: number) => void;
}) {
  const WIDTH = 480;
  const HEIGHT = 80;
  const PAD_X = 8;
  const PAD_Y = 8;
  const usableW = WIDTH - PAD_X * 2;
  const usableH = HEIGHT - PAD_Y * 2;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);

  const mainPath = useMemo(() => {
    const samples = 120;
    const points: string[] = [];
    for (let i = 0; i <= samples; i++) {
      const p = i / samples;
      const tMs = p * Math.max(1, cycleSeconds * 1000);
      const y01 = breathLevelAt(breath, tMs);
      const x = PAD_X + p * usableW;
      const y = PAD_Y + (1 - y01) * usableH;
      points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return `M${points.join(" L")}`;
  }, [breath, cycleSeconds, usableH, usableW]);

  const leadLevel = breathLevelAt(breath, nowMs);
  const leadX = PAD_X + leadProgress * usableW;
  const leadY = PAD_Y + (1 - leadLevel) * usableH;

  const progressFromClientX = (clientX: number): number => {
    const svg = svgRef.current;
    if (!svg) return leadProgress;
    const rect = svg.getBoundingClientRect();
    const xSvg = ((clientX - rect.left) / Math.max(1e-6, rect.width)) * WIDTH;
    return clamp01((xSvg - PAD_X) / usableW);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    onSeek(progressFromClientX(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    onSeek(progressFromClientX(e.clientX));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false;
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      style={{
        borderRadius: 8,
        background: "rgba(0,0,0,0.25)",
        border: "1px solid rgba(255,255,255,0.08)",
        padding: 6,
      }}
      title="Drag the playhead (or anywhere on the curve) to scrub the breath cycle. Scrubbing pauses playback."
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: 92, display: "block", cursor: "ew-resize", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <line
          x1={PAD_X}
          x2={WIDTH - PAD_X}
          y1={PAD_Y + usableH}
          y2={PAD_Y + usableH}
          stroke="rgba(255,255,255,0.2)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={PAD_X}
          x2={WIDTH - PAD_X}
          y1={PAD_Y}
          y2={PAD_Y}
          stroke="rgba(255,255,255,0.2)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={PAD_X}
            x2={WIDTH - PAD_X}
            y1={PAD_Y + (1 - t) * usableH}
            y2={PAD_Y + (1 - t) * usableH}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path
          d={mainPath}
          fill="none"
          stroke="rgba(120,215,255,0.95)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: "none" }}
        />
        {/* Scrub playhead */}
        <line
          x1={leadX}
          x2={leadX}
          y1={PAD_Y}
          y2={PAD_Y + usableH}
          stroke="rgba(255,255,255,0.35)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: "none" }}
        />
        {breath.participants.map((p) => {
          if (!p.enabled) return null;
          const x = PAD_X + (((leadProgress + p.phaseOffset) % 1) * usableW);
          const y =
            PAD_Y +
            (1 -
              breathLevelAt(
                breath,
                nowMs + p.phaseOffset * cycleSeconds * 1000,
              )) *
              usableH;
          return (
            <circle
              key={p.id}
              cx={x}
              cy={y}
              r={3.5}
              fill={p.color}
              stroke="rgba(255,255,255,0.55)"
              strokeWidth={1}
              style={{ pointerEvents: "none" }}
            />
          );
        })}
        <circle
          cx={leadX}
          cy={leadY}
          r={6}
          fill="rgba(255,255,255,0.95)"
          stroke="rgba(120,215,255,1)"
          strokeWidth={2}
          style={{ pointerEvents: "none" }}
        />
      </svg>
    </div>
  );
}

function SliderField({
  label,
  tooltip,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  tooltip?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label
      title={tooltip}
      style={{
        display: "grid",
        gridTemplateRows: "auto auto",
        gap: 4,
        background: "rgba(255,255,255,0.04)",
        borderRadius: 6,
        padding: "6px 8px",
      }}
    >
      <span style={{ fontSize: 10, textTransform: "uppercase", opacity: 0.72 }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ width: "100%" }}
        />
        <span
          style={{
            minWidth: 40,
            textAlign: "right",
            opacity: 0.82,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value.toFixed(2)}
        </span>
      </div>
    </label>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
        padding: 8,
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.45,
          opacity: 0.7,
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, minmax(120px, 1fr))",
          gap: 8,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function SegmentPill({
  label,
  width,
  color,
}: {
  label: string;
  width: number;
  color: string;
}) {
  return (
    <div
      style={{
        width: `${Math.max(0, width)}%`,
        background: color,
        borderRadius: 4,
        padding: "2px 6px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
      title={label}
    >
      {label}
    </div>
  );
}
