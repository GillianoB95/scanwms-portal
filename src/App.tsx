import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/AppLayout";
import { StaffLayout } from "@/components/StaffLayout";
import { useStaffAuth } from "@/hooks/use-staff-auth";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Shipments from "./pages/Shipments";
import ShipmentDetail from "./pages/ShipmentDetail";
import NewShipment from "./pages/NewShipment";
import MawbOverview from "./pages/staff/MawbOverview";
import HubManagement from "./pages/staff/HubManagement";
import CustomerManagement from "./pages/staff/CustomerManagement";
import InboundShipment from "./pages/staff/InboundShipment";
import OutboundShipment from "./pages/staff/OutboundShipment";
import StaffManagement from "./pages/staff/StaffManagement";
import WarehouseManagement from "./pages/staff/WarehouseManagement";
import StaffPlaceholder from "./pages/staff/StaffPlaceholder";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  console.log('[ProtectedRoute] loading:', loading, 'user:', !!user);
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <AppLayout>{children}</AppLayout>;
}

function StaffRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { data: staffAuth, isLoading: staffLoading } = useStaffAuth();

  if (loading || staffLoading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!staffAuth?.isStaff) return <Navigate to="/dashboard" replace />;
  return <StaffLayout>{children}</StaffLayout>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/shipments" element={<ProtectedRoute><Shipments /></ProtectedRoute>} />
            <Route path="/shipments/:id" element={<ProtectedRoute><ShipmentDetail /></ProtectedRoute>} />
            <Route path="/new-shipment" element={<ProtectedRoute><NewShipment /></ProtectedRoute>} />

            {/* Staff Portal */}
            <Route path="/staff" element={<StaffRoute><MawbOverview /></StaffRoute>} />
            <Route path="/staff/inbound" element={<StaffRoute><InboundShipment /></StaffRoute>} />
            <Route path="/staff/outbound" element={<StaffRoute><OutboundShipment /></StaffRoute>} />
            <Route path="/staff/hubs" element={<StaffRoute><HubManagement /></StaffRoute>} />
            <Route path="/staff/customers" element={<StaffRoute><CustomerManagement /></StaffRoute>} />
            <Route path="/staff/staff-users" element={<StaffRoute><StaffManagement /></StaffRoute>} />
            <Route path="/staff/settings" element={<StaffRoute><StaffPlaceholder title="Settings" /></StaffRoute>} />

            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
