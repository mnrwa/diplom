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
};

export type Vehicle = {
  id: number;
  plateNumber: string;
  model: string;
  status: "IDLE" | "ON_ROUTE" | "MAINTENANCE";
  driverName?: string | null;
  driverProfile?: { id: number; user?: SessionUser | null } | null;
  routes?: RouteSummary[];
  gpsLogs?: Array<{ lat: number; lon: number; speed?: number; timestamp: string }>;
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
  activeRoute?: RouteSummary & {
    waypoints?: Array<{ lat: number; lon: number }> | null;
  } | null;
  track: Array<{ lat: number; lon: number; speed?: number; timestamp: string }>;
  newsFeed: DriverNewsItem[];
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
  riskScore?: number | null;
  riskFactors?: Record<string, any> | null;
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

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = String(error?.config?.url ?? "");

    // If token expired/invalid: clear session and send user back to login.
    // Don't redirect on login/register requests to avoid loops.
    if (
      status === 401 &&
      typeof window !== "undefined" &&
      !url.includes("/auth/login") &&
      !url.includes("/auth/register")
    ) {
      try {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
      } catch {
        // ignore
      }

      const alreadyOnLogin = window.location.pathname.startsWith("/login");
      if (!alreadyOnLogin) {
        const next = encodeURIComponent(
          `${window.location.pathname}${window.location.search ?? ""}`,
        );
        window.location.replace(`/login?next=${next}`);
      }
    }

    return Promise.reject(error);
  },
);

export const login = (email: string, password: string) =>
  api.post<AuthResponse>("/auth/login", { email, password }).then((r) => r.data);

export const register = (email: string, password: string, name: string) =>
  api.post<AuthResponse>("/auth/register", { email, password, name }).then((r) => r.data);

export const getRoutes = () =>
  api.get<RouteSummary[]>("/routes").then((r) => r.data);

export const getRoute = (id: number) =>
  api.get<RouteSummary>(`/routes/${id}`).then((r) => r.data);

export const createRoute = (data: {
  name: string;
  startPointId: number;
  endPointId: number;
  vehicleId?: number;
  driverId?: number;
}) => api.post<RouteSummary>("/routes", data).then((r) => r.data);

export const recalcRoute = (id: number) =>
  api.post<RouteSummary>(`/routes/${id}/recalculate`).then((r) => r.data);

export const deleteRoute = (id: number) =>
  api.delete(`/routes/${id}`).then((r) => r.data);

export const getVehicles = () =>
  api.get<Vehicle[]>("/vehicles").then((r) => r.data);

export const createVehicle = (data: {
  plateNumber: string;
  model: string;
  driverName?: string;
}) => api.post<Vehicle>("/vehicles", data).then((r) => r.data);

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

export const getLocations = (type?: "WAREHOUSE" | "PICKUP_POINT") =>
  api
    .get<LocationPoint[]>("/locations", { params: type ? { type } : undefined })
    .then((r) => r.data);

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

export const getPositions = () =>
  api.get("/gps/positions").then((r) => r.data);

export const getRiskEvents = () =>
  api.get<RiskEvent[]>("/ai/risk-events").then((r) => r.data);
