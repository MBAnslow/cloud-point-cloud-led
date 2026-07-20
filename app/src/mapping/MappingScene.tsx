import { useEffect, useMemo, useRef, useState } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { Billboard, Grid, Line, OrbitControls, Text } from "@react-three/drei";
import {
  BufferGeometry,
  Euler,
  Matrix3,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import { useSimStore, type Vec3 } from "../state";
import { applyMappingOrientationPoint } from "./geometry";
import { loadMeshGeometry } from "./meshAsset";

interface Props {
  selected: number | null;
  setSelected: (index: number | null) => void;
}

const BASE_COLOR = "#ff9a3c";
const LAST_COLOR = "#46e16e";
const SELECTED_COLOR = "#ffffff";

export function MappingScene({ selected, setSelected }: Props) {
  const mapping = useSimStore((s) => s.mapping);
  const mesh = useSimStore((s) => s.mesh);
  const addMappedLed = useSimStore((s) => s.addMappedLed);
  const moveMappedLed = useSimStore((s) => s.moveMappedLed);
  const camera = useThree((s) => s.camera);

  const [meshGeom, setMeshGeom] = useState<BufferGeometry | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!mesh.id) {
      setMeshGeom(null);
      return;
    }
    loadMeshGeometry(mesh.id).then((g) => {
      if (!cancelled) setMeshGeom(g);
    });
    return () => {
      cancelled = true;
    };
  }, [mesh.id]);

  const draggingRef = useRef<number | null>(null);
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const [orbitEnabled, setOrbitEnabled] = useState(true);
  const [hover, setHover] = useState<{ pos: Vec3; normal: Vec3 } | null>(null);

  useEffect(() => {
    const up = () => {
      if (draggingRef.current !== null) {
        draggingRef.current = null;
        setOrbitEnabled(true);
      }
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  // World-space transform of the uploaded mesh — recomputed whenever
  // scale/offset/rotation change so LEDs (stored in mesh-local space)
  // stay glued to the surface as the mesh is repositioned.
  const meshMatrix = useMemo(() => {
    const q = new Quaternion().setFromEuler(
      new Euler(
        (mesh.tiltDeg * Math.PI) / 180,
        (mesh.yawDeg * Math.PI) / 180,
        0,
        "XYZ",
      ),
    );
    return new Matrix4().compose(
      new Vector3(0, mesh.offsetY, 0),
      q,
      new Vector3(mesh.scale, mesh.scale, mesh.scale),
    );
  }, [mesh.scale, mesh.offsetY, mesh.yawDeg, mesh.tiltDeg]);

  const meshNormalMat = useMemo(
    () => new Matrix3().getNormalMatrix(meshMatrix),
    [meshMatrix],
  );

  const localToWorldPos = (local: Vec3): Vec3 => {
    const v = new Vector3(local[0], local[1], local[2]).applyMatrix4(meshMatrix);
    return [v.x, v.y, v.z];
  };
  const localToWorldNrm = (local: Vec3): Vec3 => {
    const v = new Vector3(local[0], local[1], local[2])
      .applyMatrix3(meshNormalMat)
      .normalize();
    return [v.x, v.y, v.z];
  };

  const beads = useMemo(() => {
    const off = mapping.ledSize;
    // LEDs without a mesh-mode surface record (pos+normal) can't be
    // placed on an arbitrary mesh, so they're skipped here. Stored pos
    // and normal are in mesh-local space; we transform them to world via
    // the current mesh transform so beads follow scale/rotate/offset.
    return mapping.leds
      .map((led) => {
        if (!led.pos || !led.normal) return null;
        const lp = applyMappingOrientationPoint(
          led.pos,
          mapping.flipUpDown,
          mapping.flipLeftRight,
        );
        const ln = applyMappingOrientationPoint(
          led.normal,
          mapping.flipUpDown,
          mapping.flipLeftRight,
        );
        const wp = localToWorldPos(lp);
        const wn = localToWorldNrm(ln);
        const pos: Vec3 = [
          wp[0] + wn[0] * off,
          wp[1] + wn[1] * off,
          wp[2] + wn[2] * off,
        ];
        return { pos, normal: wn };
      })
      .filter((b): b is { pos: Vec3; normal: Vec3 } => b !== null);
  }, [
    mapping.leds,
    mapping.ledSize,
    mapping.flipUpDown,
    mapping.flipLeftRight,
    meshMatrix,
    meshNormalMat,
  ]);

  const linePoints = useMemo<Vec3[]>(
    () => beads.map((b) => [...b.pos] as Vec3),
    [beads],
  );

  const facesCamera = (pos: Vec3, normal: Vec3): boolean => {
    const vx = camera.position.x - pos[0];
    const vy = camera.position.y - pos[1];
    const vz = camera.position.z - pos[2];
    return normal[0] * vx + normal[1] * vy + normal[2] * vz > 0;
  };

  // Mesh-local hit + normal from a pointer event on the uploaded mesh.
  // Storing in local space is what keeps LEDs glued to the surface when
  // the mesh's scale/rotation/offset sliders change afterwards. We derive
  // the world hit + normal alongside for hover/max-seg checks that need
  // to compare against previously-placed beads in world space.
  const surfaceFromEvent = (
    e: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>,
  ): {
    localPos: Vec3;
    localNormal: Vec3;
    worldPos: Vec3;
    worldNormal: Vec3;
    dir: Vec3;
  } | null => {
    if (!e.face || !e.object) return null;
    e.object.updateMatrixWorld();
    const localVec = e.object.worldToLocal(
      new Vector3(e.point.x, e.point.y, e.point.z),
    );
    const localPos: Vec3 = [localVec.x, localVec.y, localVec.z];
    const localNormal: Vec3 = [
      e.face.normal.x,
      e.face.normal.y,
      e.face.normal.z,
    ];
    const nMat = new Matrix3().getNormalMatrix(e.object.matrixWorld);
    const wn = new Vector3(
      e.face.normal.x,
      e.face.normal.y,
      e.face.normal.z,
    )
      .applyMatrix3(nMat)
      .normalize();
    const worldPos: Vec3 = [e.point.x, e.point.y, e.point.z];
    const worldNormal: Vec3 = [wn.x, wn.y, wn.z];
    const l = Math.hypot(worldPos[0], worldPos[1], worldPos[2]) || 1;
    const dir: Vec3 = [worldPos[0] / l, worldPos[1] / l, worldPos[2] / l];
    return { localPos, localNormal, worldPos, worldNormal, dir };
  };

  // Previous bead's world-space position (after flips + normal offset),
  // used both to draw the hover preview line and to enforce the
  // max-segment-length rule. Null when the strand is empty.
  const prevBeadPos: Vec3 | null =
    beads.length > 0 ? beads[beads.length - 1].pos : null;

  const distance = (a: Vec3, b: Vec3) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  const withinMaxSeg = (candidate: Vec3): boolean => {
    if (!prevBeadPos) return true;
    return distance(candidate, prevBeadPos) <= mapping.maxSegmentLength + 1e-6;
  };

  // Reject placements/drags that would overlap an existing bead. Minimum
  // centre-to-centre distance is one bead diameter so beads sit side by
  // side but never on top of each other.
  const overlapsExisting = (candidate: Vec3, ignoreIndex?: number): boolean => {
    const minDist = mapping.ledSize * 2 - 1e-6;
    for (let i = 0; i < beads.length; i++) {
      if (i === ignoreIndex) continue;
      if (distance(candidate, beads[i].pos) < minDist) return true;
    }
    return false;
  };

  const onSurfaceClick = (e: ThreeEvent<MouseEvent>) => {
    if (draggingRef.current !== null) return;
    const down = downPosRef.current;
    downPosRef.current = null;
    if (down) {
      const moved = Math.hypot(
        e.nativeEvent.clientX - down.x,
        e.nativeEvent.clientY - down.y,
      );
      if (moved > 5) return;
    }
    e.stopPropagation();
    const hit = surfaceFromEvent(e);
    if (!hit) return;
    const off = mapping.ledSize;
    const previewWorld: Vec3 = [
      hit.worldPos[0] + hit.worldNormal[0] * off,
      hit.worldPos[1] + hit.worldNormal[1] * off,
      hit.worldPos[2] + hit.worldNormal[2] * off,
    ];
    if (!withinMaxSeg(previewWorld)) return;
    if (overlapsExisting(previewWorld)) return;
    const nextIndex = useSimStore.getState().mapping.leds.length;
    const dispPos = applyMappingOrientationPoint(
      hit.localPos,
      mapping.flipUpDown,
      mapping.flipLeftRight,
    );
    const dispNrm = applyMappingOrientationPoint(
      hit.localNormal,
      mapping.flipUpDown,
      mapping.flipLeftRight,
    );
    addMappedLed(hit.dir, dispPos, dispNrm);
    setHover(null);
    setSelected(nextIndex);
  };

  const onSurfacePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const hit = surfaceFromEvent(e);
    if (!hit) return;
    const idx = draggingRef.current;
    if (idx !== null) {
      e.stopPropagation();
      const off = mapping.ledSize;
      const candidateWorld: Vec3 = [
        hit.worldPos[0] + hit.worldNormal[0] * off,
        hit.worldPos[1] + hit.worldNormal[1] * off,
        hit.worldPos[2] + hit.worldNormal[2] * off,
      ];
      // Reject drags that would stretch either adjacent strand segment
      // beyond the max segment length. Neighbours are unaffected while
      // this bead is being moved, so their world positions are stable.
      const prev = idx > 0 ? beads[idx - 1] : null;
      const next = idx < beads.length - 1 ? beads[idx + 1] : null;
      const max = mapping.maxSegmentLength + 1e-6;
      if (prev && distance(candidateWorld, prev.pos) > max) return;
      if (next && distance(candidateWorld, next.pos) > max) return;
      if (overlapsExisting(candidateWorld, idx)) return;
      const dispPos = applyMappingOrientationPoint(
        hit.localPos,
        mapping.flipUpDown,
        mapping.flipLeftRight,
      );
      const dispNrm = applyMappingOrientationPoint(
        hit.localNormal,
        mapping.flipUpDown,
        mapping.flipLeftRight,
      );
      moveMappedLed(idx, hit.dir, dispPos, dispNrm);
      return;
    }
    const off = mapping.ledSize;
    const previewWorld: Vec3 = [
      hit.worldPos[0] + hit.worldNormal[0] * off,
      hit.worldPos[1] + hit.worldNormal[1] * off,
      hit.worldPos[2] + hit.worldNormal[2] * off,
    ];
    setHover({ pos: previewWorld, normal: hit.worldNormal });
  };

  return (
    <>
      <ambientLight intensity={1.1} />
      <hemisphereLight args={["#ffffff", "#20242e", 0.55]} />
      <directionalLight position={[4, 6, 4]} intensity={0.9} />
      <directionalLight position={[-5, -2, -3]} intensity={0.35} />

      <CoordinateGrid />
      <axesHelper args={[0.5]} />

      {meshGeom && (
        <mesh
          geometry={meshGeom}
          scale={mesh.scale}
          position={[0, mesh.offsetY, 0]}
          rotation={[
            (mesh.tiltDeg * Math.PI) / 180,
            (mesh.yawDeg * Math.PI) / 180,
            0,
          ]}
          onPointerDown={(e) => {
            downPosRef.current = {
              x: e.nativeEvent.clientX,
              y: e.nativeEvent.clientY,
            };
          }}
          onClick={onSurfaceClick}
          onPointerMove={onSurfacePointerMove}
          onPointerOut={() => setHover(null)}
        >
          <meshStandardMaterial
            color="#8b93a4"
            transparent
            opacity={0.65}
            roughness={0.9}
            metalness={0}
          />
        </mesh>
      )}

      {linePoints.length >= 2 && (
        <Line points={linePoints} color="#7f8ca3" lineWidth={1.5} />
      )}

      {hover && draggingRef.current === null && (() => {
        const valid = withinMaxSeg(hover.pos) && !overlapsExisting(hover.pos);
        const ghostColor = valid ? "#46e16e" : "#ff5a5a";
        return (
          <group>
            {prevBeadPos && (
              <Line
                points={[prevBeadPos, hover.pos]}
                color={ghostColor}
                lineWidth={1.5}
                dashed
                dashSize={0.04}
                gapSize={0.03}
                transparent
                opacity={0.7}
              />
            )}
            <mesh position={hover.pos}>
              <sphereGeometry args={[mapping.ledSize, 16, 12]} />
              <meshStandardMaterial
                color={ghostColor}
                emissive={ghostColor}
                emissiveIntensity={0.35}
                transparent
                opacity={0.45}
                depthWrite={false}
              />
            </mesh>
          </group>
        );
      })()}

      {beads.map(({ pos, normal }, i) => {
        const count = beads.length;
        const isLast = i === count - 1;
        const isSelected = i === selected;
        const front = facesCamera(pos, normal);
        const displayNumber = mapping.reversed ? count - i : i + 1;
        const color = isSelected
          ? SELECTED_COLOR
          : isLast
            ? LAST_COLOR
            : BASE_COLOR;
        return (
          <group key={i}>
            <mesh
              position={pos}
              onPointerDown={(e) => {
                if (!facesCamera(pos, normal)) return;
                e.stopPropagation();
                draggingRef.current = i;
                setSelected(i);
                setOrbitEnabled(false);
              }}
              onClick={(e) => {
                if (!facesCamera(pos, normal)) return;
                e.stopPropagation();
                setSelected(i);
              }}
            >
              <sphereGeometry args={[mapping.ledSize, 16, 12]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={isSelected ? 0.6 : 0.25}
                roughness={0.5}
                transparent
                opacity={front ? 1 : 0.25}
              />
            </mesh>
            <Billboard
              position={[pos[0], pos[1] + mapping.ledSize * 2.4, pos[2]]}
            >
              <Text
                fontSize={mapping.ledSize * 2.6}
                color={isSelected ? "#ffffff" : "#cfd6e6"}
                anchorX="center"
                anchorY="middle"
                outlineWidth={mapping.ledSize * 0.35}
                outlineColor="#05070d"
                fillOpacity={front ? 1 : 0.3}
                outlineOpacity={front ? 1 : 0.3}
              >
                {displayNumber}
              </Text>
            </Billboard>
          </group>
        );
      })}

      <OrbitControls makeDefault enabled={orbitEnabled} />
    </>
  );
}

/**
 * Ground reference grid with fine + coarse tick lines and centimetre
 * labels along the X and Z axes. The world unit is metres, so we draw
 * a minor line every 1 cm, a major line every 10 cm, and axis labels
 * every 10 cm reading in cm. Extent is ±HALF metres.
 */
const GRID_HALF = 1; // metres — 2 m x 2 m plane covers typical props
const GRID_MINOR_STEP = 0.01;
const GRID_MAJOR_STEP = 0.1;

function CoordinateGrid() {
  // Precompute grid + Y-ruler geometry in one pass. The XZ ground plane
  // has minor (1 cm) and major (10 cm) lines; the Y ruler is a vertical
  // line at the origin with tick marks every 1 cm (minor) / 10 cm (major).
  const {
    minorPts,
    majorPts,
    axisPts,
    yMinorPts,
    yMajorPts,
    yAxisPts,
  } = useMemo(() => {
    const minor: Vec3[] = [];
    const major: Vec3[] = [];
    const axis: Vec3[] = [];
    const yMinor: Vec3[] = [];
    const yMajor: Vec3[] = [];
    const yAxis: Vec3[] = [];
    const half = GRID_HALF;
    const eps = 1e-6;
    const isMajorTick = (v: number) =>
      Math.abs(v / GRID_MAJOR_STEP - Math.round(v / GRID_MAJOR_STEP)) < 1e-3;

    for (let x = -half; x <= half + eps; x += GRID_MINOR_STEP) {
      const list = isMajorTick(x) ? major : minor;
      list.push([x, 0, -half], [x, 0, half]);
    }
    for (let z = -half; z <= half + eps; z += GRID_MINOR_STEP) {
      const list = isMajorTick(z) ? major : minor;
      list.push([-half, 0, z], [half, 0, z]);
    }
    axis.push([-half, 0, 0], [half, 0, 0]);
    axis.push([0, 0, -half], [0, 0, half]);

    // Y ruler: vertical line at origin from -half to +half, with tick
    // marks (short XZ line segments) at each 1 cm interval.
    yAxis.push([0, -half, 0], [0, half, 0]);
    const minorTick = 0.005;
    const majorTick = 0.012;
    for (let y = -half; y <= half + eps; y += GRID_MINOR_STEP) {
      const major_ = isMajorTick(y);
      const list = major_ ? yMajor : yMinor;
      const t = major_ ? majorTick : minorTick;
      // Small crosshair ticks in both X and Z so the ruler reads from
      // any camera angle.
      list.push([-t, y, 0], [t, y, 0]);
      list.push([0, y, -t], [0, y, t]);
    }
    return {
      minorPts: minor,
      majorPts: major,
      axisPts: axis,
      yMinorPts: yMinor,
      yMajorPts: yMajor,
      yAxisPts: yAxis,
    };
  }, []);

  // Numeric labels every 10 cm along all three axes, skipping 0.
  const labels = useMemo(() => {
    const out: { pos: Vec3; text: string }[] = [];
    const steps = Math.round(GRID_HALF / GRID_MAJOR_STEP);
    for (let i = -steps; i <= steps; i++) {
      if (i === 0) continue;
      const m = i * GRID_MAJOR_STEP;
      const cm = Math.round(m * 100).toString();
      out.push({ pos: [m, 0, 0], text: cm });
      out.push({ pos: [0, 0, m], text: cm });
      out.push({ pos: [0, m, 0], text: cm });
    }
    return out;
  }, []);

  return (
    <group>
      <Line
        points={minorPts}
        segments
        color="#1c2230"
        lineWidth={0.6}
        transparent
        opacity={0.55}
      />
      <Line
        points={majorPts}
        segments
        color="#3a4356"
        lineWidth={1.1}
        transparent
        opacity={0.9}
      />
      <Line points={axisPts} segments color="#6f7d95" lineWidth={1.6} />

      <Line
        points={yMinorPts}
        segments
        color="#2a3140"
        lineWidth={0.9}
        transparent
        opacity={0.75}
      />
      <Line
        points={yMajorPts}
        segments
        color="#5a6478"
        lineWidth={1.3}
        transparent
        opacity={0.95}
      />
      <Line points={yAxisPts} segments color="#6f7d95" lineWidth={1.6} />

      {labels.map(({ pos, text }, i) => (
        <Billboard key={i} position={[pos[0], pos[1] + 0.006, pos[2]]}>
          <Text
            fontSize={0.018}
            color="#9aa4b8"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.003}
            outlineColor="#05070d"
          >
            {text}
          </Text>
        </Billboard>
      ))}

      {/* Axis letter labels at the +end of each axis. */}
      <AxisLabel position={[GRID_HALF + 0.03, 0, 0]} text="X" color="#ff6a6a" />
      <AxisLabel position={[0, GRID_HALF + 0.03, 0]} text="Y" color="#7fe37f" />
      <AxisLabel position={[0, 0, GRID_HALF + 0.03]} text="Z" color="#6aa8ff" />

      {/* Unit hint. */}
      <Billboard position={[GRID_HALF - 0.05, 0.015, 0]}>
        <Text
          fontSize={0.022}
          color="#c7d0e2"
          anchorX="right"
          anchorY="middle"
          outlineWidth={0.003}
          outlineColor="#05070d"
        >
          cm
        </Text>
      </Billboard>
    </group>
  );
}

function AxisLabel({
  position,
  text,
  color,
}: {
  position: Vec3;
  text: string;
  color: string;
}) {
  return (
    <Billboard position={position}>
      <Text
        fontSize={0.05}
        color={color}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.006}
        outlineColor="#05070d"
      >
        {text}
      </Text>
    </Billboard>
  );
}
