import axios from "axios";

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  role: "ADMIN" | "DISPATCHER" | "DRIVER";
  driverProfileId?: number | null;
};

export type AuthResponse = {
  access_token: string;
  user: SessionUser;
};

export type LocationPoint = {
  id: number;
  name: string;
  code: string;
  type: "WAREHOUSE" | "PICKUP_POINT";
  city: string;
  address: string;
  lat: number;
  lon: number;
  notes?: string | null;
  geofenceRadius?: number;
};

export type Vehicle = {
  id: number;
  plateNumber: string;
  model: string;
  status: "IDLE" | "ON_ROUTE" | "MAINTENANCE";
  driverName?: string | null;
  mileageKm?: number;
  lastServiceKm?: number;
  driverProfile?: { id: number; user?: SessionUser | null } | null;
  routes?: RouteSummary[];
  gpsLogs?: Array<{ lat: number; lon: number; speed?: number; timestamp: string }>;
  maintenanceRecords?: MaintenanceRecord[];
};

export type MaintenanceRecord = {
  id: number;
  vehicleId: number;
  type: string;
  mileageKm: number;
  scheduledAt?: string | null;
  doneAt?: string | null;
  notes?: string | null;
  createdAt: string;
};

export type MaintenancePrediction = {
  vehicleId: number;
  plateNumber: string;
  model: string;
  currentMileageKm: number;
  lastServiceKm: number;
  kmSinceService: number;
  kmToNextService: number;
  daysToNextService: number;
  urgency: "OK" | "WARNING" | "CRITICAL";
  serviceInterval: number;
  history: MaintenanceRecord[];
};

export type DriverNewsItem = {
  id: number;
  source: "TELEGRAM" | "VK" | "MAX" | "INTERNAL";
  channel: string;
  title: string;
  summary: string;
  severity: number;
  city?: string | null;
  publishedAt: string;
  url?: string | null;
};

export type DriverSummary = {
  id: number;
  userId: number;
  name: string;
  email: string;
  role: SessionUser["role"];
  phone?: string | null;
  status: "ON_SHIFT" | "RESTING" | "OFFLINE";
  rating: number;
  telematicsScore?: number | null;
  experienceYears: number;
  licenseCategory: string;
  licenseNumber?: string | null;
  shiftStartedAt?: string;
  vehicle?: Vehicle | null;
  latestPosition?: {
    lat: number;
    lon: number;
    speed?: number;
    timestamp: string;
  } | null;
  activeRoute?: RouteSummary | null;
  latestNews?: DriverNewsItem[];
};

export type DriverDetail = DriverSummary & {
  routes: RouteSummary[];
  activeRoute?: (RouteSummary & {
    waypoints?: Array<{ lat: number; lon: number }> | null;
  }) | null;
  track: Array<{ lat: number; lon: number; speed?: number; timestamp: string }>;
  newsFeed: DriverNewsItem[];
};

export type TelematicsResult = {
  driverId: number;
  score: number;
  events: Array<{ type: string; lat: number; lon: number; timestamp: string; value: number }>;
  totalPoints: number;
  speedViolations: number;
  harshBraking: number;
  harshAcceleration: number;
};

export type RouteSummary = {
  id: number;
  name: string;
  status: "PLANNED" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "RECALCULATING";
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  startPoint?: LocationPoint | null;
  endPoint?: LocationPoint | null;
  waypoints?: Array<{ lat: number; lon: number }> | null;
  distance?: number | null;
  estimatedTime?: number | null;
  mlEta?: number | null;
  riskScore?: number | null;
  riskFactors?: Record<string, any> | null;
  telegramChatId?: string | null;
  vehicle?: Vehicle | null;
  driver?: { id: number; user?: SessionUser | null } | null;
  newsItems?: DriverNewsItem[];
  gpsLogs?: Array<{ lat: number; lon: number; speed?: number; timestamp: string }>;
};

export type RiskEvent = {
  id: number;
  type: string;
  title: string;
  description?: string | null;
  severity: number;
  source: string;
  lat?: number | null;
  lon?: number | null;
};

export type HeatmapCell = {
  lat: number;
  lon: number;
  count: number;
  avgSpeed: number;
  intensity: number;
};

export type AutoAssignResult = {
  ok: boolean;
  reason?: string;
  assigned?: {
    driverId: number;
    name: string;
    rating: number;
    vehicleId?: number;
    vehiclePlate?: string;
    score: number;
    distanceToStart?: number | null;
  };
  suggestions: Array<{
    driverId: number;
    name: string;
    rating: number;
    score: number;
    distanceToStart?: number | null;
  }>;
};

export type MultistopRoute = {
  id: number;
  name: string;
  status: string;
  totalDistance?: number | null;
  estimatedTime?: number | null;
  vehicleId?: number | null;
  driverId?: number | null;
  stops: Array<{
    id: number;
    stopOrder: number;
    status: string;
    locationPoint: LocationPoint;
  }>;
};

export type Waybill = {
  id: number;
  routeId: number;
  driverName: string;
  vehiclePlate: string;
  cargoDesc?: string | null;
  signatureData?: string | null;
  checkpoints?: any[] | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type MarketplaceOrder = {
  id: number;
  title: string;
  description?: string | null;
  startAddress: string;
  endAddress: string;
  startCity: string;
  endCity: string;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  budget?: number | null;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  createdBy: { id: number; name: string; email: string };
  bids: MarketplaceBid[];
  acceptedBidId?: number | null;
  createdAt: string;
};

export type MarketplaceBid = {
  id: number;
  orderId: number;
  driverId: number;
  proposedPrice?: number | null;
  estimatedTime?: number | null;
  message?: string | null;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  driver: { id: number; user: { id: number; name: string } };
  createdAt: string;
};

export type DigitalTwin = {
  routeId: number;
  name: string;
  status: string;
  startPoint?: LocationPoint | null;
  endPoint?: LocationPoint | null;
  waypoints: Array<{ lat: number; lon: number }>;
  track: Array<{ lat: number; lon: number; speed?: number; timestamp: string }>;
  estimatedTime?: number | null;
  mlEta?: number | null;
  distance?: number | null;
  riskScore?: number | null;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export const api = axios.create({ baseURL: API_URL, withCredentials: true });

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = String(error?.config?.url ?? "");

    if (
      status === 401 &&
      typeof window !== "undefined" &&
      !url.includes("/auth/login") &&
      !url.includes("/auth/register")
    ) {
      try { localStorage.removeItem("user"); } catch {}
      const alreadyOnLogin = window.location.pathname.startsWith("/login");
      if (!alreadyOnLogin) {
        const next = encodeURIComponent(`${window.location.pathname}${window.location.search ?? ""}`);
        window.location.replace(`/login?next=${next}`);
      }
    }

    return Promise.reject(error);
  },
);

// Auth
export const login = (email: string, password: string) =>
  api.post<AuthResponse>("/auth/login", { email, password }).then((r) => r.data);

export const register = (email: string, password: string, name: string) =>
  api.post<AuthResponse>("/auth/register", { email, password, name }).then((r) => r.data);

export const getMe = () =>
  api.get<SessionUser>("/auth/me").then((r) => r.data);

export const logoutApi = () =>
  api.post("/auth/logout").then((r) => r.data);

// Routes
export const getRoutes = () =>
  api.get<RouteSummary[]>("/routes").then((r) => r.data);

export const getRoute = (id: number) =>
  api.get<RouteSummary>(`/routes/${id}`).then((r) => r.data);

export type PublicTrackRouteResponse = {
  id: number;
  name: string;
  status: RouteSummary["status"];
  startPoint?: LocationPoint | null;
  endPoint?: LocationPoint | null;
  distance?: number | null;
  estimatedTime?: number | null;
  gpsLogs: Array<{ lat: number; lon: number; speed?: number; timestamp: string }>;
  createdAt: string;
  updatedAt: string;
};

export const publicTrackRoute = (id: number) =>
  api.get<PublicTrackRouteResponse>(`/public/track/${id}`).then((r) => r.data);

export const createRoute = (data: {
  name: string;
  startPointId: number;
  endPointId: number;
  vehicleId?: number;
  driverId?: number;
  telegramChatId?: string;
}) => api.post<RouteSummary>("/routes", data).then((r) => r.data);

export const recalcRoute = (id: number) =>
  api.post<RouteSummary>(`/routes/${id}/recalculate`).then((r) => r.data);

export const deleteRoute = (id: number) =>
  api.delete(`/routes/${id}`).then((r) => r.data);

export const autoAssignRoute = (routeId: number) =>
  api.post<AutoAssignResult>(`/routes/${routeId}/auto-assign`).then((r) => r.data);

export const getRouteMlEta = (routeId: number) =>
  api.get<{ routeId: number; staticEta?: number | null; mlEta: number; confidence: number; factors: Record<string, any> }>(`/routes/${routeId}/eta`).then((r) => r.data);

export const getDigitalTwin = (routeId: number) =>
  api.get<DigitalTwin>(`/routes/${routeId}/twin`).then((r) => r.data);

export const createMultistop = (data: { name: string; startPointId: number; stopIds: number[]; vehicleId?: number; driverId?: number }) =>
  api.post<MultistopRoute>("/routes/multistop", data).then((r) => r.data);

export const getMultistopRoutes = () =>
  api.get<MultistopRoute[]>("/routes/multistop/list").then((r) => r.data);

// Vehicles
export const getVehicles = () =>
  api.get<Vehicle[]>("/vehicles").then((r) => r.data);

export const createVehicle = (data: { plateNumber: string; model: string; driverName?: string }) =>
  api.post<Vehicle>("/vehicles", data).then((r) => r.data);

export const getVehicleMaintenance = (vehicleId: number) =>
  api.get<MaintenancePrediction>(`/vehicles/${vehicleId}/maintenance`).then((r) => r.data);

export const logMaintenance = (vehicleId: number, data: { type: string; notes?: string }) =>
  api.post(`/vehicles/${vehicleId}/maintenance`, data).then((r) => r.data);

// Drivers
export const getDrivers = () =>
  api.get<DriverSummary[]>("/drivers").then((r) => r.data);

export const getDriver = (id: number) =>
  api.get<DriverDetail>(`/drivers/${id}`).then((r) => r.data);

export const getMyDriverProfile = () =>
  api.get<DriverDetail>("/drivers/me").then((r) => r.data);

export const createDriverAccount = (data: {
  name: string;
  email: string;
  password: string;
  phone?: string;
  licenseNumber?: string;
  licenseCategory?: string;
  experienceYears?: number;
  vehicleId?: number;
}) => api.post("/drivers", data).then((r) => r.data);

export const getDriverTelematics = (driverId: number) =>
  api.get<TelematicsResult>(`/drivers/${driverId}/telematics`).then((r) => r.data);

// Locations
export const getLocations = (type?: "WAREHOUSE" | "PICKUP_POINT") =>
  api.get<LocationPoint[]>("/locations", { params: type ? { type } : undefined }).then((r) => r.data);

export const createLocation = (data: {
  name: string;
  code?: string;
  type: "WAREHOUSE" | "PICKUP_POINT";
  city: string;
  address: string;
  lat: number;
  lon: number;
  notes?: string;
}) => api.post<LocationPoint>("/locations", data).then((r) => r.data);

// GPS
export const getPositions = () =>
  api.get("/gps/positions").then((r) => r.data);

export const getHeatmap = () =>
  api.get<HeatmapCell[]>("/gps/heatmap").then((r) => r.data);

// AI
export const getRiskEvents = () =>
  api.get<RiskEvent[]>("/ai/risk-events").then((r) => r.data);

// Geocode
export type GeocodeResult = {
  displayName: string;
  lat: number;
  lon: number;
  city: string;
  address: string;
  country: string;
};

export const geocodeAddress = (q: string) =>
  api.get<GeocodeResult[]>("/locations/geocode", { params: { q } }).then((r) => r.data);

export const publicGeocodeAddress = (q: string) =>
  api.get<GeocodeResult[]>("/public/geocode", { params: { q } }).then((r) => r.data);

export type QuickRouteInput = {
  name?: string;
  startLat: number;
  startLon: number;
  startName: string;
  startCity: string;
  startAddress: string;
  endLat: number;
  endLon: number;
  endName: string;
  endCity: string;
  endAddress: string;
  vehicleId?: number;
  driverId?: number;
  telegramChatId?: string;
};

export const createQuickRoute = (data: QuickRouteInput) =>
  api.post<RouteSummary>("/routes/quick", data).then((r) => r.data);

export const publicCreateOrder = (data: QuickRouteInput) =>
  api.post<RouteSummary>("/public/order", data).then((r) => r.data);

// Waybill
export const getWaybill = (routeId: number) =>
  api.get<Waybill>(`/waybill/route/${routeId}`).then((r) => r.data);

export const signWaybill = (routeId: number, signatureData: string) =>
  api.post<Waybill>(`/waybill/route/${routeId}/sign`, { signatureData }).then((r) => r.data);

// Marketplace
export const getMarketplaceOrders = (status?: string) =>
  api.get<MarketplaceOrder[]>("/marketplace", { params: status ? { status } : undefined }).then((r) => r.data);

export const getMarketplaceOrder = (id: number) =>
  api.get<MarketplaceOrder>(`/marketplace/${id}`).then((r) => r.data);

export const createMarketplaceOrder = (data: {
  title: string;
  description?: string;
  startAddress: string;
  endAddress: string;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  startCity: string;
  endCity: string;
  budget?: number;
}) => api.post<MarketplaceOrder>("/marketplace", data).then((r) => r.data);

export const deleteMarketplaceOrder = (id: number) =>
  api.delete(`/marketplace/${id}`).then((r) => r.data);

export const submitBid = (orderId: number, data: { proposedPrice?: number; estimatedTime?: number; message?: string }) =>
  api.post<MarketplaceBid>(`/marketplace/${orderId}/bid`, data).then((r) => r.data);

export const acceptBid = (orderId: number, bidId: number) =>
  api.post<MarketplaceOrder>(`/marketplace/${orderId}/accept/${bidId}`).then((r) => r.data);

export const completeMarketplaceOrder = (id: number) =>
  api.post<MarketplaceOrder>(`/marketplace/${id}/complete`).then((r) => r.data);

export const getMyBids = () =>
  api.get<MarketplaceBid[]>("/marketplace/my-bids").then((r) => r.data);
