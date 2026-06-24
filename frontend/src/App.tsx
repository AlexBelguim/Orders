import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import PasswordProtected from './components/PasswordProtected';
import AdminPanel from './pages/AdminPanel';
import OrderPage from './pages/OrderPage';
import PrepScreenPage from './pages/PrepScreenPage';
import StatsPage from './pages/StatsPage';
import TrackPage from './pages/TrackPage';
import DispatchPage from './pages/DispatchPage';
import AgentPage from './pages/AgentPage';
import PaymentPendingPage from './pages/PaymentPendingPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Gated (staff) routes */}
        <Route path="/admin" element={<PasswordProtected><AdminPanel /></PasswordProtected>} />
        <Route path="/screen/:slug" element={<PasswordProtected><PrepScreenPage /></PasswordProtected>} />
        <Route path="/stats" element={<PasswordProtected><StatsPage /></PasswordProtected>} />
        <Route path="/dispatch" element={<PasswordProtected><DispatchPage /></PasswordProtected>} />

        {/* Public customer routes */}
        <Route path="/l/:locationCode" element={<OrderPage />} />
        <Route path="/t/:tableCode" element={<OrderPage />} />
        <Route path="/o/:token" element={<TrackPage />} />
        <Route path="/o/payment-pending" element={<PaymentPendingPage />} />

        {/* Public agent route */}
        <Route path="/bezorger/:code" element={<AgentPage />} />

        <Route path="*" element={<Navigate to="/admin" />} />
      </Routes>
    </BrowserRouter>
  );
}
