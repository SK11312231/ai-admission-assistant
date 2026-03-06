import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Leads from './pages/Leads'
import Settings from './pages/Settings'

// TODO: Replace with auth context / dynamic institute selection
const INSTITUTE_ID = 1

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#f9fafb' }}>
        <Sidebar />
        <main style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard instituteId={INSTITUTE_ID} />} />
            <Route path="/leads" element={<Leads instituteId={INSTITUTE_ID} />} />
            <Route path="/settings" element={<Settings instituteId={INSTITUTE_ID} />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
