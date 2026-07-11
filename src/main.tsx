import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthProvider } from './lib/auth'
import { RequireAuth, RequireAdmin } from './surfaces/auth/guards'
import LoginPage from './surfaces/auth/LoginPage'
import ChatPage from './surfaces/chat/ChatPage'
import DraftPage from './surfaces/draft/DraftPage'
import AdminPage from './surfaces/admin/AdminPage'
import TeachPage from './surfaces/teach/TeachPage'
import CallPage from './surfaces/call/CallPage'
import './index.css'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireAuth />}>
              <Route element={<App />}>
                <Route index element={<Navigate to="/chat" replace />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/call" element={<CallPage />} />
                <Route path="/draft" element={<DraftPage />} />
                <Route element={<RequireAdmin />}>
                  <Route path="/admin" element={<AdminPage />} />
                  <Route path="/teach" element={<TeachPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
