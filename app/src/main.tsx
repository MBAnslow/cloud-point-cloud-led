import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import { MappingApp } from "./mapping/MappingApp";
import { DronesApp } from "./drones/DronesApp";
import { PadsApp } from "./pads/PadsApp";
import { SamplesApp } from "./samples/SamplesApp";
import { DroneRuntime } from "./audio/DroneRuntime";
import { PadRuntime } from "./audio/PadRuntime";
import { SampleRuntime } from "./audio/SampleRuntime";
import { MasterFxRuntime } from "./audio/MasterFxRuntime";
import { LightningAudioRuntime } from "./audio/LightningAudioRuntime";
import { startPersistence } from "./state/persistRuntime";
import { startOscBreathClient } from "./breath/oscBreathClient";

startPersistence();
startOscBreathClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <DroneRuntime />
    <PadRuntime />
    <SampleRuntime />
    <MasterFxRuntime />
    <LightningAudioRuntime />
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/mapping" element={<MappingApp />} />
      <Route path="/drones" element={<DronesApp />} />
      <Route path="/pads" element={<PadsApp />} />
      <Route path="/samples" element={<SamplesApp />} />
    </Routes>
  </HashRouter>,
);
