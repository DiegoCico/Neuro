import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Auth from "./pages/Auth";
import ServerTest from "./pages/ServerTest";
// import Dashboard from "./pages/Dashboard"; // you can keep your main signed-in UI here

export default function App() {
  return (
    <Routes>
      {/* Login page */}
      <Route path="/auth" element={<Auth />} />
      <Route path="/test" element={<ServerTest />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
