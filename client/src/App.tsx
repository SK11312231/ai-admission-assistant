import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Register from './pages/Register';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Chat from './pages/Chat';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import CompletePayment from './pages/CompletePayment';
import Demo from './pages/Demo';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Navbar />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/register" element={<Register />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/complete-payment" element={<CompletePayment />} />
            <Route path="/demo" element={<Demo />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/demo" element={null} />
            <Route path="/privacy-policy" element={null} />
            <Route path="/terms-of-service" element={null} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}