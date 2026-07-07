import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import { MappingApp } from "./mapping/MappingApp";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/mapping" element={<MappingApp />} />
    </Routes>
  </HashRouter>,
);
