import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth } from './auth';
import Layout from './components/Layout';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Builder from './pages/Builder';
import Credentials from './pages/Credentials';
import Sessions from './pages/Sessions';
import Logs from './pages/Logs';
import Subscriptions from './pages/Subscriptions';

export default function App() {
  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/bots/:botId/builder" element={<RequireAuth><Builder /></RequireAuth>} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/credentials" element={<Credentials />} />
        <Route path="/subscriptions" element={<Subscriptions />} />
        <Route path="/bots/:botId/sessions" element={<Sessions />} />
        <Route path="/bots/:botId/logs" element={<Logs />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
