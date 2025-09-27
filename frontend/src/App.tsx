// src/App.tsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Auth from "./pages/Auth";
import ServerTest from "./pages/ServerTest";
import Home from "./pages/Home";
import FaceSetup from "./pages/FaceSetup";
import Onboarding from "./pages/Onboarding";
import RequireAuth from "./components/RequireAuth";
import ProfilePage, { RedirectToMyProfile } from "./pages/ProfilePage";
import MessagesScreen from "./pages/MessagesScreen";

export default function App() {
  return (
    <Routes>
      {/* Auth */}
      <Route path="/auth" element={<Auth />} />

      {/* Protected routes */}
      <Route
        path="/home"
        element={
          <RequireAuth>
            <Home />
          </RequireAuth>
        }
      />
      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <Onboarding />
          </RequireAuth>
        }
      />
      <Route
        path="/webcam"
        element={
          <RequireAuth>
            <FaceSetup />
          </RequireAuth>
        }
      />
      <Route
        path="/profile"
        element={
          <RequireAuth>
            <RedirectToMyProfile />
          </RequireAuth>
        }
      />
      <Route
        path="/u/:slug"
        element={
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        }
      />
      <Route
        path="/messages"
        element={
          <RequireAuth>
            <MessagesScreen />
          </RequireAuth>
        }
      />

      {/* Utility/testing */}
      <Route path="/test" element={<ServerTest />} />

      {/* Default: if path is `/`, decide based on auth later */}
      <Route path="/" element={<Navigate to="/auth" replace />} />

      {/* Catch-all → redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
