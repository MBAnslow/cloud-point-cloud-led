import { useSimStore, type AudioSolo } from "../state";

type Instrument = Exclude<AudioSolo, null>;

export function AudioSoloButton({
  instrument,
  accent,
}: {
  instrument: Instrument;
  accent: string;
}) {
  const solo = useSimStore((s) => s.audioSolo);
  const setAudioSolo = useSimStore((s) => s.setAudioSolo);
  const active = solo === instrument;

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setAudioSolo(active ? null : instrument)}
      title={
        active
          ? "Restore all music instruments"
          : `Solo ${instrument}; mute the other music instruments`
      }
      style={{
        marginLeft: 8,
        minWidth: 58,
        padding: "5px 10px",
        borderRadius: 5,
        border: `1px solid ${active ? accent : "rgba(255,255,255,0.25)"}`,
        background: active ? `${accent}35` : "rgba(255,255,255,0.07)",
        color: active ? accent : "rgba(255,255,255,0.82)",
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {active ? "Solo ✓" : "Solo"}
    </button>
  );
}
