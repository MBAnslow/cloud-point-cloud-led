import { useEffect, useMemo, useRef, useState } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { Billboard, Grid, Line, OrbitControls, Text } from "@react-three/drei";
import { useSimStore, type Vec3 } from "../state";
import {
  applyMappingOrientation,
  dirFromSurfacePoint,
  surfaceNormal,
  surfacePoint,
} from "./geometry";

interface Props {
  selected: number | null;
  setSelected: (index: number | null) => void;
}

const BASE_COLOR = "#ff9a3c";
const LAST_COLOR = "#46e16e";
const SELECTED_COLOR = "#ffffff";

export function MappingScene({ selected, setSelected }: Props) {
  const ellipsoid = useSimStore((s) => s.ellipsoid);
  const mapping = useSimStore((s) => s.mapping);
  const addMappedLed = useSimStore((s) => s.addMappedLed);
  const moveMappedLed = useSimStore((s) => s.moveMappedLed);
  const camera = useThree((s) => s.camera);

  const draggingRef = useRef<number | null>(null);
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const [orbitEnabled, setOrbitEnabled] = useState(true);

  // End any in-progress drag as soon as the pointer is released anywhere.
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

  const beads = useMemo(() => {
    const off = mapping.ledSize;
    return mapping.leds.map((led) => {
      const dir = applyMappingOrientation(
        led.dir,
        mapping.flipUpDown,
        mapping.flipLeftRight,
      );
      const p = surfacePoint(dir, ellipsoid);
      const n = surfaceNormal(dir, ellipsoid);
      const pos: Vec3 = [
        p[0] + n[0] * off,
        p[1] + n[1] * off,
        p[2] + n[2] * off,
      ];
      return { pos, normal: n };
    });
  }, [
    mapping.leds,
    mapping.ledSize,
    mapping.flipUpDown,
    mapping.flipLeftRight,
    ellipsoid,
  ]);

  const linePoints = useMemo<Vec3[]>(
    () => beads.map((b) => [...b.pos] as Vec3),
    [beads],
  );

  // A bead is only interactive if its surface faces the camera; this stops
  // clicks from selecting LEDs on the far side "through" the oval.
  const facesCamera = (pos: Vec3, normal: Vec3): boolean => {
    const vx = camera.position.x - pos[0];
    const vy = camera.position.y - pos[1];
    const vz = camera.position.z - pos[2];
    return normal[0] * vx + normal[1] * vy + normal[2] * vz > 0;
  };

  const onEllipsoidClick = (e: ThreeEvent<MouseEvent>) => {
    if (draggingRef.current !== null) return;
    // Ignore clicks that were really camera-orbit drags.
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
    const p: Vec3 = [e.point.x, e.point.y, e.point.z];
    const nextIndex = useSimStore.getState().mapping.leds.length;
    const displayDir = dirFromSurfacePoint(p, ellipsoid);
    addMappedLed(
      applyMappingOrientation(
        displayDir,
        mapping.flipUpDown,
        mapping.flipLeftRight,
      ),
    );
    setSelected(nextIndex);
  };

  const onEllipsoidPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const idx = draggingRef.current;
    if (idx === null) return;
    e.stopPropagation();
    const p: Vec3 = [e.point.x, e.point.y, e.point.z];
    const displayDir = dirFromSurfacePoint(p, ellipsoid);
    moveMappedLed(
      idx,
      applyMappingOrientation(
        displayDir,
        mapping.flipUpDown,
        mapping.flipLeftRight,
      ),
    );
  };

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 6, 4]} intensity={0.9} />
      <directionalLight position={[-5, -2, -3]} intensity={0.35} />

      <Grid
        args={[20, 20]}
        cellSize={0.5}
        sectionSize={2}
        cellColor="#222"
        sectionColor="#333"
        fadeDistance={30}
        fadeStrength={1.5}
        infiniteGrid
        position={[0, -Math.max(ellipsoid.ry, 1.5) - 0.01, 0]}
      />
      <axesHelper args={[1]} />

      {/* Ellipsoid surface — the click/drag target. */}
      <mesh
        scale={[ellipsoid.rx, ellipsoid.ry, ellipsoid.rz]}
        onPointerDown={(e) => {
          downPosRef.current = {
            x: e.nativeEvent.clientX,
            y: e.nativeEvent.clientY,
          };
        }}
        onClick={onEllipsoidClick}
        onPointerMove={onEllipsoidPointerMove}
      >
        <sphereGeometry args={[1, 64, 48]} />
        <meshStandardMaterial
          color="#39414f"
          transparent
          opacity={0.55}
          roughness={0.95}
          metalness={0}
        />
      </mesh>

      {/* String order path. */}
      {linePoints.length >= 2 && (
        <Line points={linePoints} color="#7f8ca3" lineWidth={1.5} />
      )}

      {/* Placed LED beads + number labels. */}
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
              position={[
                pos[0],
                pos[1] + mapping.ledSize * 2.4,
                pos[2],
              ]}
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
