/** An incident from an incident management provider. */
export interface Incident {
  /** Provider-specific unique identifier. */
  id: string;
  /** Incident title / summary. */
  title: string;
  /** Current incident status. */
  status: "triggered" | "acknowledged" | "resolved";
  /** Incident urgency level. */
  urgency: "high" | "low";
  /** Web URL to view the incident. */
  url: string;
  /** Service associated with the incident. */
  service?: string;
}

/** Options for creating a new incident. */
export interface IncidentCreateOptions {
  /** Incident title / summary. */
  title: string;
  /** Incident description body. */
  description?: string;
  /** Urgency level (defaults to provider-specific default). */
  urgency?: "high" | "low";
  /** Service ID to associate with the incident. */
  serviceId?: string;
}

/** An on-call schedule entry representing a person currently on call. */
export interface OnCallEntry {
  /** Provider-specific user identifier. */
  userId: string;
  /** Display name of the on-call person. */
  name: string;
  /** Email address of the on-call person. */
  email?: string;
}

/** Provider interface for managing incidents and on-call schedules. */
export interface IncidentProvider {
  /**
   * Verify that the provider credentials and connection are valid.
   * @returns Resolves if access is valid; rejects otherwise.
   */
  verifyAccess(): Promise<void>;

  /**
   * Create a new incident.
   * @param opts - Incident creation options.
   * @returns The newly created incident.
   */
  createIncident(opts: IncidentCreateOptions): Promise<Incident>;

  /**
   * Acknowledge an active incident.
   * @param id - Provider-specific incident ID.
   */
  acknowledgeIncident(id: string): Promise<void>;

  /**
   * Resolve an incident.
   * @param id - Provider-specific incident ID.
   * @param resolution - Optional resolution note.
   */
  resolveIncident(id: string, resolution?: string): Promise<void>;

  /**
   * Retrieve the current on-call roster.
   * @param scheduleId - Optional schedule ID to scope the query.
   * @returns List of on-call entries.
   */
  getOnCall(scheduleId?: string): Promise<OnCallEntry[]>;
}
