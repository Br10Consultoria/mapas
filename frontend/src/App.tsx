import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import DashboardPage from './pages/DashboardPage'
import TopologyPage from './pages/TopologyPage'
import DevicesPage from './pages/DevicesPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="topology" element={<TopologyPage />} />
          <Route path="devices" element={<DevicesPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
