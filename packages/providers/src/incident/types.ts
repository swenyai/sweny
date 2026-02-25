export interface Incident {
  id: string;
  title: string;
  status: "triggered" | "acknowledged" | "resolved";
  urgency: "high" | "low";
  url: string;
  service?: string;
}

export interface IncidentCreateOptions {
  title: string;
  description?: string;
  urgency?: "high" | "low";
  serviceId?: string;
}

export interface OnCallEntry {
  userId: string;
  name: string;
  email?: string;
}

export interface IncidentProvider {
  verifyAccess(): Promise<void>;
  createIncident(opts: IncidentCreateOptions): Promise<Incident>;
  acknowledgeIncident(id: string): Promise<void>;
  resolveIncident(id: string, resolution?: string): Promise<void>;
  getOnCall(scheduleId?: string): Promise<OnCallEntry[]>;
}
